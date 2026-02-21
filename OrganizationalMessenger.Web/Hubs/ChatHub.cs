// ✅ ChatHub.cs - SignalR Hub برای Real-time Communication

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using OrganizationalMessenger.Application.Interfaces;
using OrganizationalMessenger.Domain.Entities;
using OrganizationalMessenger.Domain.Enums;
using OrganizationalMessenger.Infrastructure.Data;
using System.Collections.Concurrent;
using System.Security.Claims;

namespace OrganizationalMessenger.Web.Hubs
{
    [Authorize]
    public class ChatHub : Hub
    {
        private readonly ApplicationDbContext _context;
        private readonly ILogger<ChatHub> _logger;
        private readonly IMessageService _messageService;

        // 🚨 Thread-safe dictionary برای نگهداری ConnectionId های هر کاربر
        private static readonly ConcurrentDictionary<int, List<string>> _userConnections = new();

        public ChatHub(
            ApplicationDbContext context,
            ILogger<ChatHub> logger,
            IMessageService messageService)
        {
            _logger = logger;
            _context = context;
            _messageService = messageService;
        }

        // ✅ متد Helper برای دریافت UserId
        private int GetUserId()
        {
            return int.TryParse(
                Context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value,
                out int id) ? id : 0;
        }

        // ✅ متد Helper برای دریافت ConnectionId های یک کاربر
        private static List<string>? GetUserConnections(int userId)
        {
            return _userConnections.TryGetValue(userId, out var connections) ? connections : null;
        }

        // ✅ متد Helper برای چک کردن آنلاین بودن
        private static bool IsUserOnline(int userId)
        {
            return _userConnections.ContainsKey(userId);
        }

        public override async Task OnConnectedAsync()
        {
            var userId = GetUserId();
            if (userId == 0)
            {
                await base.OnConnectedAsync();
                return;
            }

            _logger.LogInformation($"✅ User {userId} connected: {Context.ConnectionId}");

            // ذخیره ConnectionId
            _userConnections.AddOrUpdate(userId,
                new List<string> { Context.ConnectionId },
                (key, list) => { list.Add(Context.ConnectionId); return list; });

            // به‌روزرسانی در دیتابیس
            var user = await _context.Users.FindAsync(userId);
            if (user != null)
            {
                user.IsOnline = true;
                user.LastSeen = DateTime.Now;
                await _context.SaveChangesAsync();

                await Clients.Others.SendAsync("UserOnline", userId);
            }

            await MarkReceivedMessagesAsDelivered(userId);
            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            var userId = GetUserId();
            if (userId > 0 && _userConnections.TryGetValue(userId, out var connections))
            {
                connections.Remove(Context.ConnectionId);
                if (connections.Count == 0)
                {
                    _userConnections.TryRemove(userId, out _);

                    var user = await _context.Users.FindAsync(userId);
                    if (user != null)
                    {
                        user.IsOnline = false;
                        user.LastSeen = DateTime.Now;
                        await _context.SaveChangesAsync();

                        await Clients.Others.SendAsync("UserOffline", userId, DateTime.Now);
                    }
                }
            }
            await base.OnDisconnectedAsync(exception);
        }

        public async Task SendPrivateMessage(int receiverId, string messageText, int? replyToMessageId = null)
        {
            var senderId = GetUserId();
            if (senderId == 0) return;

            try
            {
                var message = new Message
                {
                    SenderId = senderId,
                    ReceiverId = receiverId,
                    Content = messageText,
                    MessageText = messageText,
                    Type = MessageType.Text,
                    SentAt = DateTime.UtcNow,
                    IsDelivered = false,
                    ReplyToMessageId = replyToMessageId
                };

                _context.Messages.Add(message);
                await _context.SaveChangesAsync();

                // ✅ بارگذاری Sender و ReplyToMessage
                await _context.Entry(message).Reference(m => m.Sender).LoadAsync();
                if (replyToMessageId.HasValue)
                {
                    await _context.Entry(message).Reference(m => m.ReplyToMessage).LoadAsync();
                    if (message.ReplyToMessage != null)
                    {
                        await _context.Entry(message.ReplyToMessage).Reference(m => m.Sender).LoadAsync();
                    }
                }

                var messageDto = new
                {
                    id = message.Id,
                    messageId = message.Id,
                    chatId = receiverId,
                    senderId = message.SenderId,
                    senderName = $"{message.Sender.FirstName} {message.Sender.LastName}",
                    senderAvatar = message.Sender.AvatarUrl ?? "/images/default-avatar.png",
                    content = message.Content,
                    messageText = message.MessageText,
                    type = message.Type,
                    sentAt = message.SentAt.ToString("o"),
                    isDelivered = false,
                    isRead = false,
                    isEdited = false,
                    replyToMessageId = message.ReplyToMessageId,
                    replyToText = message.ReplyToMessage?.Content,
                    replyToSenderName = message.ReplyToMessage != null
                        ? $"{message.ReplyToMessage.Sender.FirstName} {message.ReplyToMessage.Sender.LastName}"
                        : null,
                    attachments = new List<object>()
                };

                // ✅ ارسال به گیرنده
                await Clients.User(receiverId.ToString()).SendAsync("ReceiveMessage", messageDto);

                // ✅ تأیید به فرستنده
                await Clients.Caller.SendAsync("MessageSent", messageDto);

                // ✅ چک آنلاین بودن گیرنده
                if (IsUserOnline(receiverId))
                {
                    message.IsDelivered = true;
                    message.DeliveredAt = DateTime.UtcNow;
                    await _context.SaveChangesAsync();

                    await Clients.All.SendAsync("MessageDelivered", new
                    {
                        messageId = message.Id,
                        deliveredAt = message.DeliveredAt?.ToString("o")
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SendPrivateMessage error");
                await Clients.Caller.SendAsync("Error", "خطا در ارسال پیام");
            }
        }

        public async Task ConfirmDelivery(int messageId)
        {
            var userId = GetUserId();
            var message = await _context.Messages.FindAsync(messageId);

            if (message?.ReceiverId == userId && !message.IsDelivered)
            {
                message.IsDelivered = true;
                message.DeliveredAt = DateTime.Now;
                await _context.SaveChangesAsync();

                await Clients.All.SendAsync("MessageDelivered", new
                {
                    messageId,
                    deliveredAt = message.DeliveredAt
                });
            }
        }

        public async Task MarkAsRead(int messageId)
        {
            var userId = GetUserId();
            if (userId == 0) return;

            if (await _context.MessageReads.AnyAsync(mr => mr.MessageId == messageId && mr.UserId == userId))
                return;

            var read = new MessageRead
            {
                MessageId = messageId,
                UserId = userId,
                ReadAt = DateTime.Now
            };

            _context.MessageReads.Add(read);
            await _context.SaveChangesAsync();

            await Clients.All.SendAsync("MessageRead", new
            {
                messageId,
                userId,
                readAt = read.ReadAt.ToString("o")
            });
        }

        public async Task SendTyping(int receiverId)
        {
            var connections = GetUserConnections(receiverId);
            if (connections != null)
            {
                foreach (var conn in connections)
                    await Clients.Client(conn).SendAsync("UserTyping", "کاربر در حال تایپ...");
            }
        }

        public async Task SendStoppedTyping(int receiverId)
        {
            var connections = GetUserConnections(receiverId);
            if (connections != null)
            {
                foreach (var conn in connections)
                    await Clients.Client(conn).SendAsync("UserStoppedTyping");
            }
        }

        public async Task NotifyMessagesRead(List<int> messageIds)
        {
            var userId = GetUserId();
            if (userId == 0) return;

            try
            {
                var messages = await _context.Messages
                    .Where(m => messageIds.Contains(m.Id))
                    .ToListAsync();

                foreach (var message in messages)
                {
                    var readReceipt = await _context.MessageReads
                        .FirstOrDefaultAsync(mr => mr.MessageId == message.Id && mr.UserId == userId);

                    if (readReceipt != null)
                    {
                        await Clients.User(message.SenderId.ToString()).SendAsync("MessageRead", new
                        {
                            messageId = message.Id,
                            readAt = readReceipt.ReadAt
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "NotifyMessagesRead error");
            }
        }

        /// <summary>
        /// ✅ ارسال پیام با فایل
        /// </summary>
        public async Task SendPrivateMessageWithFile(
            int receiverId,
            string messageText,
            int fileId,
            int? duration = null)
        {
            var senderId = GetUserId();
            if (senderId == 0) return;

            try
            {
                var file = await _context.FileAttachments.FindAsync(fileId);
                if (file == null)
                {
                    _logger.LogError($"❌ File {fileId} not found");
                    return;
                }

                MessageType messageType = MessageType.File;
                if (file.FileType == "Audio") messageType = MessageType.Audio;
                else if (file.FileType == "Image") messageType = MessageType.Image;
                else if (file.FileType == "Video") messageType = MessageType.Video;

                var message = new Message
                {
                    SenderId = senderId,
                    ReceiverId = receiverId,
                    MessageText = messageText,
                    Content = messageText,
                    Type = messageType,
                    SentAt = DateTime.UtcNow,
                    IsDelivered = false,
                    IsDeleted = false
                };

                _context.Messages.Add(message);
                await _context.SaveChangesAsync();

                file.MessageId = message.Id;
                await _context.SaveChangesAsync();

                await _context.Entry(message).Collection(m => m.Attachments).LoadAsync();
                await _context.Entry(message).Reference(m => m.Sender).LoadAsync();

                var messageDto = new
                {
                    id = message.Id,
                    senderId = message.SenderId,
                    senderName = $"{message.Sender.FirstName} {message.Sender.LastName}",
                    senderAvatar = message.Sender.AvatarUrl ?? "/images/default-avatar.png",
                    content = message.Content,
                    messageText = message.MessageText,
                    type = message.Type,
                    sentAt = message.SentAt.ToString("o"),
                    isDelivered = false,
                    isRead = false,
                    chatId = receiverId,
                    attachments = message.Attachments.Select(f => new
                    {
                        id = f.Id,
                        fileName = f.FileName,
                        originalFileName = f.OriginalFileName,
                        fileUrl = f.FileUrl,
                        thumbnailUrl = f.ThumbnailUrl,
                        fileType = f.FileType,
                        fileSize = f.FileSize,
                        width = f.Width,
                        height = f.Height,
                        extension = f.Extension,
                        duration = f.Duration,
                        readableSize = f.ReadableFileSize,
                        readableDuration = f.ReadableDuration
                    }).ToList()
                };

                // ✅ ارسال به گیرنده
                var connections = GetUserConnections(receiverId);
                if (connections != null)
                {
                    foreach (var connectionId in connections)
                    {
                        await Clients.Client(connectionId).SendAsync("ReceiveMessage", messageDto);
                    }

                    message.IsDelivered = true;
                    message.DeliveredAt = DateTime.UtcNow;
                    await _context.SaveChangesAsync();

                    await Clients.All.SendAsync("MessageDelivered", new
                    {
                        messageId = message.Id,
                        deliveredAt = message.DeliveredAt?.ToString("o")
                    });
                }

                // ✅ تأیید به فرستنده
                await Clients.Caller.SendAsync("MessageSent", messageDto);

                _logger.LogInformation($"✅ File message sent: {message.Id}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SendPrivateMessageWithFile error");
                await Clients.Caller.SendAsync("Error", $"خطا در ارسال: {ex.Message}");
            }
        }

        public async Task NotifyMessageEdited(int messageId, string newContent, DateTime editedAt)
        {
            var userId = GetUserId();
            if (userId == 0) return;

            var message = await _context.Messages.FindAsync(messageId);
            if (message == null || message.SenderId != userId) return;

            await Clients.All.SendAsync("MessageEdited", new
            {
                messageId,
                newContent,
                editedAt = editedAt.ToString("o"),
                senderId = userId
            });
        }

        public async Task NotifyMessageDeleted(int messageId, bool showNotice, int? receiverId)
        {
            var userId = GetUserId();
            if (userId == 0) return;

            try
            {
                _logger.LogInformation($"🗑️ NotifyMessageDeleted: messageId={messageId}, showNotice={showNotice}");

                if (receiverId.HasValue)
                {
                    var connections = GetUserConnections(receiverId.Value);
                    if (connections != null)
                    {
                        foreach (var connectionId in connections)
                        {
                            await Clients.Client(connectionId).SendAsync("MessageDeleted", new
                            {
                                messageId,
                                showNotice,
                                deletedAt = DateTime.Now.ToString("o"),
                                senderId = userId,
                                receiverId
                            });
                        }
                    }
                }

                await Clients.Caller.SendAsync("MessageDeleted", new
                {
                    messageId,
                    showNotice,
                    deletedAt = DateTime.Now.ToString("o"),
                    senderId = userId,
                    receiverId
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "NotifyMessageDeleted error");
            }
        }

        public async Task NotifyMessageReaction(int messageId, string emoji, string action, List<object> reactions)
        {
            var userId = GetUserId();
            if (userId == 0) return;

            try
            {
                await Clients.All.SendAsync("MessageReaction", new
                {
                    messageId,
                    emoji,
                    action,
                    userId,
                    reactions
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "NotifyMessageReaction error");
            }
        }

        private async Task MarkReceivedMessagesAsDelivered(int userId)
        {
            try
            {
                var messages = await _context.Messages
                    .Where(m => m.ReceiverId == userId &&
                               !m.IsDelivered &&
                               m.SentAt > DateTime.Now.AddHours(-24))
                    .ToListAsync();

                foreach (var msg in messages)
                {
                    msg.IsDelivered = true;
                    msg.DeliveredAt = DateTime.Now;
                }

                if (messages.Any())
                {
                    await _context.SaveChangesAsync();
                    _logger.LogInformation($"📦 {messages.Count} messages marked Delivered for user {userId}");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MarkReceivedMessagesAsDelivered error");
            }
        }
    }
}
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using OrganizationalMessenger.Application.DTOs;
using OrganizationalMessenger.Application.Interfaces;
using OrganizationalMessenger.Domain.Entities;
using OrganizationalMessenger.Domain.Enums;
using OrganizationalMessenger.Infrastructure.Data;

namespace OrganizationalMessenger.Infrastructure.Services
{
    public class MessageService : IMessageService
    {
        private readonly ApplicationDbContext _context;
        private readonly ILogger<MessageService> _logger;

        public MessageService(
            ApplicationDbContext context,
            ILogger<MessageService> logger)
        {
            _context = context;
            _logger = logger;
        }

        /// <summary>
        /// ✅ متد اصلی: ارسال یکپارچه پیام
        /// </summary>
        public async Task<(bool Success, Message? Message, string? ErrorMessage)> SendMessageAsync(
            SendMessageRequest request,
            int senderId)
        {
            try
            {
                // ✅ 1. اعتبارسنجی پایه
                var (isValid, validationError) = request.Validate();
                if (!isValid)
                {
                    _logger.LogWarning("Validation failed for message from user {SenderId}: {Error}",
                        senderId, validationError);
                    return (false, null, validationError);
                }

                // ✅ 2. بررسی مجوزها
                var (hasPermission, denyReason) = await CheckSendPermissionAsync(request, senderId);
                if (!hasPermission)
                {
                    _logger.LogWarning("Permission denied for user {SenderId}: {Reason}",
                        senderId, denyReason);
                    return (false, null, denyReason);
                }

                // ✅ 3. اعتبارسنجی محتوا (کلمات ممنوعه)
                var (contentValid, contentError) = await ValidateContentAsync(request.MessageText);
                if (!contentValid)
                {
                    return (false, null, contentError);
                }

                // ✅ 4. ساخت پیام
                var message = CreateMessageEntity(request, senderId);

                // ✅ 5. ذخیره در دیتابیس
                _context.Messages.Add(message);
                await _context.SaveChangesAsync();

                // ✅ 6. اتصال فایل پس از ذخیره (تا ID پیام مشخص باشد)
                if (request.FileAttachmentId.HasValue)
                {
                    var file = await _context.FileAttachments.FindAsync(request.FileAttachmentId.Value);
                    if (file != null)
                    {
                        file.MessageId = message.Id;
                        await _context.SaveChangesAsync();
                    }
                }

                // ✅ 7. بارگذاری روابط برای SignalR
                await _context.Entry(message)
                    .Reference(m => m.Sender)
                    .LoadAsync();

                if (message.ReplyToMessageId.HasValue)
                {
                    await _context.Entry(message)
                        .Reference(m => m.ReplyToMessage)
                        .LoadAsync();
                }

                if (request.FileAttachmentId.HasValue)
                {
                    await _context.Entry(message)
                        .Collection(m => m.Attachments)
                        .LoadAsync();
                }

                _logger.LogInformation("Message {MessageId} sent successfully by user {SenderId}",
                    message.Id, senderId);

                return (true, message, null);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error sending message from user {SenderId}", senderId);
                return (false, null, "خطا در ارسال پیام");
            }
        }

        /// <summary>
        /// ✅ ساخت entity پیام
        /// </summary>
        private static Message CreateMessageEntity(SendMessageRequest request, int senderId)
        {
            return new Message
            {
                SenderId = senderId,
                ReceiverId = request.ReceiverId,
                GroupId = request.GroupId,
                ChannelId = request.ChannelId,
                MessageText = request.MessageText,
                Content = request.MessageText,
                Type = request.Type,
                SentAt = DateTime.Now,
                IsSystemMessage = request.IsSystemMessage,
                ReplyToMessageId = request.ReplyToMessageId,
                ForwardedFromMessageId = request.ForwardedFromMessageId,
                ForwardedFromUserId = request.ForwardedFromUserId,
                CreatedAt = DateTime.Now
            };
        }

        /// <summary>
        /// ✅ بررسی مجوزهای ارسال
        /// </summary>
        public async Task<(bool HasPermission, string? DenyReason)> CheckSendPermissionAsync(
            SendMessageRequest request,
            int senderId)
        {
            var user = await _context.Users.FindAsync(senderId);
            if (user == null || !user.IsActive || user.IsBlocked)
            {
                return (false, "کاربر غیرفعال یا مسدود است");
            }

            // بررسی مجوز کانال
            if (request.ChannelId.HasValue)
            {
                var userChannel = await _context.UserChannels
                    .FirstOrDefaultAsync(uc => uc.ChannelId == request.ChannelId && uc.UserId == senderId);

                if (userChannel == null || !userChannel.IsActive)
                {
                    return (false, "شما عضو این کانال نیستید");
                }

                var channel = await _context.Channels.FindAsync(request.ChannelId);
                if (channel?.OnlyAdminsCanPost == true && !userChannel.CanPost)
                {
                    return (false, "فقط ادمین‌ها می‌توانند پست ارسال کنند");
                }
            }

            // بررسی مجوز گروه
            if (request.GroupId.HasValue)
            {
                var userGroup = await _context.UserGroups
                    .FirstOrDefaultAsync(ug => ug.GroupId == request.GroupId && ug.UserId == senderId);

                if (userGroup == null || !userGroup.IsActive)
                {
                    return (false, "شما عضو این گروه نیستید");
                }

                if (userGroup.IsMuted && (!userGroup.MutedUntil.HasValue || userGroup.MutedUntil > DateTime.Now))
                {
                    return (false, "شما در این گروه بی‌صدا شده‌اید");
                }
            }

            // بررسی مجوز چت خصوصی
            if (request.ReceiverId.HasValue)
            {
                var receiver = await _context.Users.FindAsync(request.ReceiverId);
                if (receiver == null || !receiver.IsActive || receiver.IsBlocked)
                {
                    return (false, "گیرنده غیرفعال یا مسدود است");
                }
            }

            return (true, null);
        }

        /// <summary>
        /// ✅ اعتبارسنجی محتوا (کلمات ممنوعه)
        /// </summary>
        public async Task<(bool IsValid, string? Reason)> ValidateContentAsync(string? content)
        {
            if (string.IsNullOrWhiteSpace(content))
            {
                return (true, null);
            }

            var forbiddenWords = await _context.ForbiddenWords
                .Where(fw => fw.IsActive)
                .Select(fw => fw.Word)
                .ToListAsync();

            foreach (var word in forbiddenWords)
            {
                if (content.Contains(word, StringComparison.OrdinalIgnoreCase))
                {
                    return (false, "پیام حاوی کلمات ممنوعه است");
                }
            }

            return (true, null);
        }

        /// <summary>
        /// ✅ دریافت لیست گیرندگان
        /// </summary>
        public async Task<List<int>> GetRecipientsAsync(SendMessageRequest request)
        {
            var recipients = new List<int>();

            if (request.ReceiverId.HasValue)
            {
                recipients.Add(request.ReceiverId.Value);
            }
            else if (request.GroupId.HasValue)
            {
                recipients = await _context.UserGroups
                    .Where(ug => ug.GroupId == request.GroupId && ug.IsActive)
                    .Select(ug => ug.UserId)
                    .ToListAsync();
            }
            else if (request.ChannelId.HasValue)
            {
                recipients = await _context.UserChannels
                    .Where(uc => uc.ChannelId == request.ChannelId && uc.IsActive)
                    .Select(uc => uc.UserId)
                    .ToListAsync();
            }

            return recipients;
        }

        /// <summary>
        /// ✅ ارسال نوتیفیکیشن‌ها
        /// </summary>
        public async Task SendNotificationsAsync(Message message, List<int> recipientIds)
        {
            // TODO: پیاده‌سازی SMS, Push Notification و ...
            await Task.CompletedTask;
        }
    }
}

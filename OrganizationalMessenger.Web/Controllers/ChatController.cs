using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using OrganizationalMessenger.Application.Interfaces;
using OrganizationalMessenger.Domain.Entities;
using OrganizationalMessenger.Domain.Enums;
using OrganizationalMessenger.Infrastructure.Data;
using OrganizationalMessenger.Web.Hubs;
using System.Security.Claims;

namespace OrganizationalMessenger.Web.Controllers
{
    [Authorize]
    public class ChatController : Controller
    {
        private readonly ApplicationDbContext _context;
        private readonly IHubContext<ChatHub> _hubContext;
        private readonly IMessageService _messageService; // ✅ اضافه شد

        public ChatController(
            ApplicationDbContext context,
            IHubContext<ChatHub> hubContext,
            IMessageService messageService) // ✅ اضافه شد
        {
            _context = context;
            _hubContext = hubContext;
            _messageService = messageService; // ✅ اضافه شد
        }


        // صفحه اصلی چت
        [HttpGet]
        public async Task<IActionResult> Index()
        {
            var userId = GetCurrentUserId();
            if (userId == null)
                return RedirectToAction("Login", "Account");

            var user = await _context.Users
                .Include(u => u.UserGroups)
                    .ThenInclude(ug => ug.Group)
                .Include(u => u.UserChannels)
                    .ThenInclude(uc => uc.Channel)
                .FirstOrDefaultAsync(u => u.Id == userId.Value);

            if (user == null)
                return RedirectToAction("Login", "Account");

            ViewBag.CurrentUser = user;
            ViewBag.Chats = await GetUserChats(userId.Value);
            return View();
        }

        // دریافت لیست چتها
        [HttpGet]
        [Route("Chat/GetChats")]
        public async Task<IActionResult> GetChats(string tab = "all")
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            var chats = await GetUserChats(userId.Value, tab);
            return Json(chats);
        }


        [HttpGet]
        public async Task<IActionResult> GetAllUsers()
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            var users = await _context.Users
                .Where(u => u.Id != userId.Value && u.IsActive)
                .OrderBy(u => u.FirstName)
                .ThenBy(u => u.LastName)
                .Select(u => new
                {
                    id = u.Id,
                    name = $"{u.FirstName} {u.LastName}",
                    avatar = u.AvatarUrl ?? "/images/default-avatar.png",
                    type = "private"
                })
                .ToListAsync();

            return Json(users);
        }



        [HttpGet]
        [Route("Chat/Permissions")]
        
        public IActionResult GetPermissions(int userId)
        {
            try
            {
                var user = _context.Users.Find(userId);
                if (user == null) return NotFound(new { success = false });

                return Ok(new
                {
                    success = true,
                    canCreateGroup = user.CanCreateGroup,
                    canCreateChannel = user.CanCreateChannel
                });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }



        // دریافت پیامهای یک چت
        // دریافت پیامهای یک چت - با Pagination
        [HttpGet]
        public async Task<IActionResult> GetMessages(
                int? userId,
                int? groupId,
                int? channelId,  // ✅ اضافه کنید
                int pageSize = 20,
                int? beforeMessageId = null)
        {
            var currentUserId = GetCurrentUserId();
            if (currentUserId == null) return Unauthorized();

            IQueryable<Message> query = _context.Messages
                .Include(m => m.Sender)
                .Include(m => m.ReadReceipts)
                .Include(m => m.Attachments)
                .Include(m => m.ReplyToMessage)
                    .ThenInclude(r => r.Sender)
                .Include(m => m.ForwardedFromUser)
                .Include(m => m.Reactions)
                    .ThenInclude(r => r.User)
                // ✅ اضافه کنید
                .Include(m => m.Poll)
                    .ThenInclude(p => p.Options)
                        .ThenInclude(o => o.Votes)
                .Where(m => !m.IsSystemMessage);

            // ✅ شرط جدید برای کانال
            if (userId.HasValue)
            {
                query = query.Where(m =>
                    (m.SenderId == currentUserId && m.ReceiverId == userId) ||
                    (m.SenderId == userId && m.ReceiverId == currentUserId));
            }
            else if (groupId.HasValue)
            {
                query = query.Where(m => m.GroupId == groupId);
            }
            else if (channelId.HasValue)  // ✅ اضافه کنید
            {
                query = query.Where(m => m.ChannelId == channelId);
            }
            else
            {
                return BadRequest("userId, groupId or channelId is required");
            }

            if (beforeMessageId.HasValue)
            {
                var beforeMessage = await _context.Messages.FindAsync(beforeMessageId.Value);
                if (beforeMessage != null)
                {
                    query = query.Where(m => m.SentAt < beforeMessage.SentAt);
                }
            }

            var messages = await query
                .OrderByDescending(m => m.Id)
                .Take(pageSize)
                .ToListAsync();

            messages.Reverse();

            var showDeletedNoticeStr = await _context.SystemSettings
                .Where(s => s.Key == "ShowDeletedMessageNotice")
                .Select(s => s.Value)
                .FirstOrDefaultAsync();

            bool showDeletedNotice = true;
            if (!string.IsNullOrEmpty(showDeletedNoticeStr))
            {
                showDeletedNotice = showDeletedNoticeStr.ToLower() == "true";
            }

            var result = messages
                .Where(m => showDeletedNotice || !m.IsDeleted)
                .Select(m => new
                {
                    m.Id,
                    MessageText = m.IsDeleted ? null : m.MessageText,
                    Content = m.IsDeleted ? null : m.Content,
                    m.Type,
                    m.SentAt,
                    m.DeliveredAt,
                    m.IsEdited,
                    m.EditedAt,
                    m.IsDeleted,
                    m.DeletedAt,
                    SenderId = m.SenderId,
                    SenderName = $"{m.Sender.FirstName} {m.Sender.LastName}",
                    SenderAvatar = m.Sender.AvatarUrl ?? "/images/default-avatar.png",
                    IsDelivered = m.IsDelivered,
                    IsRead = m.SenderId == currentUserId.Value
                        ? m.ReadReceipts.Any(r => r.UserId == m.ReceiverId)
                        : m.ReadReceipts.Any(r => r.UserId == currentUserId.Value),
                    ReadAt = m.SenderId == currentUserId.Value
                        ? m.ReadReceipts
                            .Where(r => r.UserId == m.ReceiverId)
                            .Select(r => (DateTime?)r.ReadAt)
                            .FirstOrDefault()
                        : m.ReadReceipts
                            .Where(r => r.UserId == currentUserId.Value)
                            .Select(r => (DateTime?)r.ReadAt)
                            .FirstOrDefault(),
                    replyToMessageId = m.ReplyToMessageId,
                    replyToText = m.ReplyToMessage != null ? m.ReplyToMessage.Content : null,
                    replyToSenderName = m.ReplyToMessage != null
                    ? m.ReplyToMessage.Sender.FirstName + " " + m.ReplyToMessage.Sender.LastName
                    : null,
                                    // ✅ اضافه: پرویو فایل ریپلای
                                    replyToAttachment = m.ReplyToMessage != null && m.ReplyToMessage.Attachments.Any()
                    ? new
                    {
                        fileUrl = m.ReplyToMessage.Attachments.First().FileUrl,
                        fileType = m.ReplyToMessage.Attachments.First().FileType,
                        originalFileName = m.ReplyToMessage.Attachments.First().OriginalFileName
                    }
                    : null,
                    // ✅ اضافه کن - فوروارد
                    ForwardedFromMessageId = m.ForwardedFromMessageId,
                    ForwardedFromUserId = m.ForwardedFromUserId,
                    ForwardedFromUserName = m.ForwardedFromUser != null
                        ? $"{m.ForwardedFromUser.FirstName} {m.ForwardedFromUser.LastName}"
                        : null,
                    Attachments = m.IsDeleted
                        ? new List<object>()
                        : m.Attachments
                            .Where(a => !a.IsDeleted)
                            .Select(a => (object)new
                            {
                                a.Id,
                                a.OriginalFileName,
                                a.FileUrl,
                                a.ThumbnailUrl,
                                FileType = a.FileType.ToString(),
                                a.FileSize,
                                a.Extension,
                                ReadableSize = a.ReadableFileSize,
                                a.Width,
                                a.Height,
                                a.Duration,
                                ReadableDuration = a.ReadableDuration
                            })
                            .ToList(),
                    // ✅ اضافه کردن Reactions با hasReacted
                    Reactions = m.Reactions
                        .GroupBy(r => r.Emoji)
                        .Select(g => new
                        {
                            emoji = g.Key,
                            count = g.Count(),
                            users = g.Select(r => new
                            {
                                id = r.UserId,
                                name = $"{r.User.FirstName} {r.User.LastName}"
                            }).ToList(),
                            hasReacted = g.Any(r => r.UserId == currentUserId.Value)
                        })
                        .ToList(),


                    // ✅ نظرسنجی - کامل
                    PollId = m.PollId,
                    Poll = m.Poll != null ? new
                    {
                        id = m.Poll.Id,
                        question = m.Poll.Question,
                        // ✅ isActive باید expire رو هم چک کنه
                        isActive = m.Poll.IsActive && (!m.Poll.ExpiresAt.HasValue || DateTime.Now < m.Poll.ExpiresAt.Value),
                        allowMultipleAnswers = m.Poll.AllowMultipleAnswers,
                        // ✅ pollType بر اساس ExpiresAt نه IsActive
                        pollType = m.Poll.ExpiresAt.HasValue ? "closed" : "open",
                        createdAt = m.Poll.CreatedAt,
                        // ✅ expiresAt - این مهمترین فیلد هست!
                        expiresAt = m.Poll.ExpiresAt.HasValue
                            ? m.Poll.ExpiresAt.Value.ToString("yyyy-MM-ddTHH:mm:ss", System.Globalization.CultureInfo.InvariantCulture)
                            : (string?)null,
                        options = m.Poll.Options.OrderBy(o => o.DisplayOrder).Select(o => new
                        {
                            id = o.Id,
                            text = o.Text,
                            voteCount = o.Votes.Count,
                            hasVoted = o.Votes.Any(v => v.UserId == currentUserId.Value)
                        }).ToList()
                    } : (object?)null,




                })
                .ToList();

            return Json(new
            {
                messages = result,
                hasMore = messages.Count == pageSize
            });
        }



        // ✅ اصلاح SendMessage - با کپشن
        [HttpPost("SendMessage")]
        public async Task<IActionResult> SendMessage([FromBody] SendMessageRequest request)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            try
            {
                // ✅ ایجاد پیام
                var message = new Message
                {
                    SenderId = userId.Value,
                    ReceiverId = request.ReceiverId,
                    GroupId = request.GroupId,
                    ChannelId = request.ChannelId,
                    MessageText = request.MessageText,
                    Content = request.MessageText,
                    Type = (MessageType)request.Type,
                    ReplyToMessageId = request.ReplyToId, // ✅ استفاده از ReplyToId
                    SentAt = DateTime.Now,
                    IsDelivered = false,
                    IsDeleted = false
                };

                _context.Messages.Add(message);
                await _context.SaveChangesAsync();

                // ✅ اگر فایل دارد، MessageId را به‌روز کن
                if (request.FileAttachmentId.HasValue)
                {
                    var file = await _context.FileAttachments.FindAsync(request.FileAttachmentId.Value);
                    if (file != null)
                    {
                        file.MessageId = message.Id; // ✅ لینک کردن فایل به پیام
                        await _context.SaveChangesAsync();
                        Console.WriteLine($"✅ FileAttachment {file.Id} linked to Message {message.Id}");
                    }
                }

                return Ok(new
                {
                    success = true,
                    messageId = message.Id,
                    sentAt = message.SentAt
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ SendMessage error: {ex.Message}");
                return StatusCode(500, new { success = false, message = ex.Message });
            }
        }


        // متد کمکی برای گرفتن آی‌دی کاربر فعلی
        private int? GetCurrentUserId()
        {
            var claim = User.FindFirst(ClaimTypes.NameIdentifier);
            if (claim == null)
                return null;

            if (int.TryParse(claim.Value, out var id))
                return id;

            return null;
        }


        // ✅ موقتاً برای تست - 2 کاربر دیگه بساز



        // متد کمکی

        // ✅ جایگزین این متد کمکی موجود کنید:

        private async Task<dynamic> GetUserChats(int userId, string tab = "all")
        {
            var chats = new List<dynamic>();

            // ✅ چت‌های خصوصی
            // ✅ چت‌های خصوصی - فقط افرادی که ارتباط داشته‌ایم
            // ✅ چت‌های خصوصی - فقط افرادی که ارتباط داشته‌ایم
            if (tab == "all" || tab == "private")
            {
                // ✅ فقط کاربرانی که با آنها پیام رد و بدل شده
                var contactUserIds = await _context.Messages
                    .Where(m => (m.SenderId == userId || m.ReceiverId == userId) &&
                                m.GroupId == null && m.ChannelId == null)
                    .Select(m => m.SenderId == userId ? m.ReceiverId.Value : m.SenderId)
                    .Where(id => id != userId)
                    .Distinct()
                    .ToListAsync();

                var users = await _context.Users
                    .Where(u => contactUserIds.Contains(u.Id) && u.IsActive)
                    .OrderBy(u => u.FirstName)
                    .ThenBy(u => u.LastName)
                    .ToListAsync();

                foreach (var user in users)
                {
                    var fullName = $"{user.FirstName} {user.LastName}".Trim();

                    var lastMessage = await _context.Messages
                        .Where(m =>
                            ((m.SenderId == userId && m.ReceiverId == user.Id) ||
                             (m.SenderId == user.Id && m.ReceiverId == userId)))
                        .OrderByDescending(m => m.Id)
                        .FirstOrDefaultAsync();

                    var unreadCount = await _context.Messages
                        .Where(m => m.SenderId == user.Id &&
                                   m.ReceiverId == userId &&
                                   !_context.MessageReads.Any(mr => mr.MessageId == m.Id && mr.UserId == userId))
                        .CountAsync();

                    chats.Add(new
                    {
                        type = "private",
                        id = user.Id,
                        name = fullName,
                        avatar = user.AvatarUrl ?? "/images/default-avatar.png",
                        isOnline = user.IsOnline,
                        lastSeen = user.LastSeen?.ToString("o"),       // ✅ اضافه شد - ISO format
                        lastSeenHour = user.LastSeen?.Hour,             // ✅ ساعت آخرین بازدید (0-23)
                        lastSeenMinute = user.LastSeen?.Minute,         // ✅ دقیقه
                        lastMessage = lastMessage != null ? (lastMessage.MessageText ?? lastMessage.Content ?? "") : "",
                        lastMessageTime = lastMessage?.SentAt ?? user.LastSeen ?? user.CreatedAt,
                        lastMessageId = lastMessage?.Id ?? 0,
                        unreadCount,
                        messageDirection = lastMessage?.SenderId == userId ? "sent" : "received"
                    });
                }
            }

            // ✅ گروه‌ها
            if (tab == "all" || tab == "groups")
            {
                var groups = await _context.UserGroups
                    .Where(ug => ug.UserId == userId && ug.IsActive)
                    .Include(ug => ug.Group)
                    .ToListAsync();

                foreach (var ug in groups)
                {
                    var lastMessage = await _context.Messages
                        .Where(m => m.GroupId == ug.GroupId && !m.IsDeleted)
                        .OrderByDescending(m => m.Id)
                        .FirstOrDefaultAsync();
                    var unreadCount = await _context.Messages
                        .Where(m => m.GroupId == ug.GroupId &&
                                    !m.IsDeleted &&
                                    m.SenderId != userId &&  // پیام‌های خودم رو نشمار
                                    !_context.MessageReads.Any(mr => mr.MessageId == m.Id && mr.UserId == userId))
                        .CountAsync();
                    var memberCount = await _context.UserGroups
                        .CountAsync(x => x.GroupId == ug.GroupId && x.IsActive);

                    chats.Add(new
                    {
                        type = "group",
                        id = ug.Group.Id,
                        name = ug.Group.Name,
                        avatar = ug.Group.AvatarUrl ?? "/images/default-group.png",
                        isOnline = false,
                        lastMessage = lastMessage != null ?
                         (lastMessage.MessageText ?? lastMessage.Content ?? "") : "بدون پیام",
                        lastMessageTime = lastMessage?.SentAt ?? ug.Group.CreatedAt,
                        lastMessageId = lastMessage?.Id ?? 0,
                        memberCount,
                        unreadCount,  // ✅ حالا واقعی حساب میشه
                        role = ug.Role.ToString(),
                        isAdmin = ug.IsAdmin,
                        isMuted = ug.IsMuted
                    });

                }
            }

            // ✅ کانال‌ها
            if (tab == "all" || tab == "channels")
            {
                var channels = await _context.UserChannels
                    .Where(uc => uc.UserId == userId && uc.IsActive)
                    .Include(uc => uc.Channel)
                    .Where(uc => !uc.Channel.IsDeleted)
                    .ToListAsync();

                foreach (var uc in channels)
                {
                    var lastMessage = await _context.Messages
                        .Where(m => m.ChannelId == uc.ChannelId && !m.IsDeleted)
                        .OrderByDescending(m => m.Id)
                        .FirstOrDefaultAsync();

                    var unreadCount = await _context.Messages
                        .Where(m => m.ChannelId == uc.ChannelId &&
                                    !m.IsDeleted &&
                                    m.SenderId != userId &&
                                    !_context.MessageReads.Any(mr => mr.MessageId == m.Id && mr.UserId == userId))
                        .CountAsync();
                    chats.Add(new
                    {
                        type = "channel",
                        id = uc.Channel.Id,
                        name = uc.Channel.Name,
                        avatar = uc.Channel.AvatarUrl ?? "/images/default-channel.png",
                        isOnline = false,
                        lastMessage = lastMessage != null ?
                            (lastMessage.MessageText ?? lastMessage.Content ?? "") : "بدون پیام",
                        lastMessageTime = lastMessage?.SentAt ?? uc.Channel.CreatedAt,
                        lastMessageId = lastMessage?.Id ?? 0,
                        memberCount = uc.Channel.MemberCount,
                        unreadCount,  // ✅ واقعی
                        role = uc.Role.ToString(),
                        isAdmin = uc.IsAdmin,
                        canPost = uc.CanPost,
                        isMuted = uc.IsMuted,
                        isPinned = uc.IsPinned
                    });

                }
            }

            return chats
                .OrderByDescending(c => c.lastMessageId)   // 👈 حالا بر اساس Id آخرین پیام
                .ThenByDescending(c => c.lastMessageTime ?? DateTime.MinValue) // اختیاری، tie-breaker
                .ToList();
        }



        // ✅ جستجوی کاربر برای شروع چت جدید
        // ✅ جستجوی کاربران برای شروع چت جدید
        [HttpGet]
        [Route("Chat/SearchUsers")]
        public async Task<IActionResult> SearchUsers(string query = "")
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            IQueryable<User> usersQuery = _context.Users
                .Where(u => u.Id != userId.Value && u.IsActive);

            // اگر query خالی باشد، همه کاربران را برگردان
            if (!string.IsNullOrWhiteSpace(query) && query.Length >= 2)
            {
                usersQuery = usersQuery.Where(u =>
                    u.FirstName.Contains(query) || u.LastName.Contains(query) ||
                    (u.PhoneNumber != null && u.PhoneNumber.Contains(query)) ||
                    (u.Username != null && u.Username.Contains(query)));
            }

            var users = await usersQuery
                .OrderBy(u => u.FirstName)
                .ThenBy(u => u.LastName)
                .Take(50)
                .Select(u => new
                {
                    id = u.Id,
                    name = u.FirstName + " " + u.LastName,
                    avatar = u.AvatarUrl ?? "/images/default-avatar.png",
                    isOnline = u.IsOnline
                })
                .ToListAsync();

            return Json(new { success = true, users });
        }


        // ✅ DTO ها




        // ✅ فقط این 2 متد رو اضافه کن (بقیه رو دست نزن):

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> MarkMessagesAsRead([FromBody] MarkAsReadRequest request)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            if (request?.MessageIds == null || !request.MessageIds.Any())
                return Json(new { success = true, markedCount = 0 });

            var now = DateTime.Now;

            // ✅ پیام‌هایی که باید read بشن (خصوصی + گروه + کانال)
            var messagesToMark = await _context.Messages
                .Where(m => request.MessageIds.Contains(m.Id) &&
                            m.SenderId != userId.Value)  // ✅ فقط پیام‌های دیگران (نه خودم)
                .ToListAsync();

            var markedCount = 0;

            foreach (var message in messagesToMark)
            {
                // ✅ چک کن قبلاً read نشده باشه
                var alreadyRead = await _context.MessageReads
                    .AnyAsync(mr => mr.MessageId == message.Id && mr.UserId == userId.Value);

                if (!alreadyRead)
                {
                    _context.MessageReads.Add(new MessageRead
                    {
                        MessageId = message.Id,
                        UserId = userId.Value,
                        ReadAt = now
                    });
                    markedCount++;
                }
            }

            if (markedCount > 0)
            {
                await _context.SaveChangesAsync();
            }

            return Json(new { success = true, markedCount });
        }

        // ✅ کلاس DTO (فقط 1 بار - خط آخر کلاس)
        public class MarkAsReadRequest
        {
            public List<int> MessageIds { get; set; } = new();
        }







        [AllowAnonymous]
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> SignOut()
        {
            await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);

            // پاک کردن تمام cookie ها
            Response.Cookies.Delete(".AspNetCore.Cookies");

            return RedirectToAction("Login", "Account");
        }

        //*************************************************************
        // ✅ دریافت تنظیمات
        [HttpGet]
        public async Task<IActionResult> GetMessageSettings()
        {
            try
            {
                var allowEdit = await _context.SystemSettings
                    .Where(s => s.Key == "AllowMessageEdit")
                    .Select(s => s.Value.ToLower() == "true")
                    .FirstOrDefaultAsync();

                var allowDelete = await _context.SystemSettings
                    .Where(s => s.Key == "AllowMessageDelete")
                    .Select(s => s.Value.ToLower() == "true")
                    .FirstOrDefaultAsync();

                var editTimeLimitStr = await _context.SystemSettings
                    .Where(s => s.Key == "MessageEditTimeLimit")
                    .Select(s => s.Value)
                    .FirstOrDefaultAsync();

                int editTimeLimit = 3600;
                if (!string.IsNullOrEmpty(editTimeLimitStr))
                {
                    int.TryParse(editTimeLimitStr, out editTimeLimit);
                }

                var deleteTimeLimitStr = await _context.SystemSettings
                    .Where(s => s.Key == "MessageDeleteTimeLimit")
                    .Select(s => s.Value)
                    .FirstOrDefaultAsync();

                int deleteTimeLimit = 7200;
                if (!string.IsNullOrEmpty(deleteTimeLimitStr))
                {
                    int.TryParse(deleteTimeLimitStr, out deleteTimeLimit);
                }

                return Ok(new
                {
                    success = true,
                    allowEdit,
                    allowDelete,
                    editTimeLimit,
                    deleteTimeLimit
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, message = ex.Message });
            }
        }

        // ✅ ویرایش پیام
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> EditMessage([FromBody] EditMessageRequest request)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            try
            {
                var message = await _context.Messages
                    .FirstOrDefaultAsync(m => m.Id == request.MessageId && m.SenderId == userId.Value);

                if (message == null)
                    return NotFound(new { success = false, message = "پیام یافت نشد یا دسترسی ندارید" });

                // ✅ اضافه کن - فوروارد قابل ویرایش نیست
                if (message.ForwardedFromMessageId.HasValue)
                    return BadRequest(new { success = false, message = "پیام ارجاع‌شده قابل ویرایش نیست" });


                var allowEdit = await _context.SystemSettings
                    .Where(s => s.Key == "AllowMessageEdit")
                    .Select(s => s.Value.ToLower() == "true")
                    .FirstOrDefaultAsync();

                if (!allowEdit)
                    return BadRequest(new { success = false, message = "ویرایش پیام غیرفعال است" });

                var editTimeLimitStr = await _context.SystemSettings
                    .Where(s => s.Key == "MessageEditTimeLimit")
                    .Select(s => s.Value)
                    .FirstOrDefaultAsync();

                int editTimeLimit = 3600;
                if (!string.IsNullOrEmpty(editTimeLimitStr))
                {
                    int.TryParse(editTimeLimitStr, out editTimeLimit);
                }

                var elapsedSeconds = (DateTime.Now - message.SentAt).TotalSeconds;
                if (elapsedSeconds > editTimeLimit)
                {
                    return BadRequest(new
                    {
                        success = false,
                        message = $"زمان مجاز ویرایش ({editTimeLimit} ثانیه) گذشته است"
                    });
                }

                message.Content = request.NewContent;
                message.MessageText = request.NewContent;
                message.IsEdited = true;
                message.EditedAt = DateTime.Now;

                await _context.SaveChangesAsync();

                return Ok(new
                {
                    success = true,
                    message = "پیام با موفقیت ویرایش شد",
                    editedAt = message.EditedAt
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, message = ex.Message });
            }
        }






        // ✅ حذف پیام
        // ✅ حذف پیام - با تنظیمات
        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> DeleteMessage([FromBody] DeleteMessageRequest request)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            try
            {
                var message = await _context.Messages
                    .Include(m => m.Attachments)
                    .FirstOrDefaultAsync(m => m.Id == request.MessageId && m.SenderId == userId.Value);

                if (message == null)
                    return NotFound(new { success = false, message = "پیام یافت نشد یا دسترسی ندارید" });

                var allowDelete = await _context.SystemSettings
                    .Where(s => s.Key == "AllowMessageDelete")
                    .Select(s => s.Value.ToLower() == "true")
                    .FirstOrDefaultAsync();

                if (!allowDelete)
                    return BadRequest(new { success = false, message = "حذف پیام غیرفعال است" });

                var deleteTimeLimitStr = await _context.SystemSettings
                    .Where(s => s.Key == "MessageDeleteTimeLimit")
                    .Select(s => s.Value)
                    .FirstOrDefaultAsync();

                int deleteTimeLimit = 7200;
                if (!string.IsNullOrEmpty(deleteTimeLimitStr))
                {
                    int.TryParse(deleteTimeLimitStr, out deleteTimeLimit);
                }

                var elapsedSeconds = (DateTime.Now - message.SentAt).TotalSeconds;
                if (elapsedSeconds > deleteTimeLimit)
                {
                    return BadRequest(new
                    {
                        success = false,
                        message = $"زمان مجاز حذف ({deleteTimeLimit} ثانیه) گذشته است"
                    });
                }

                var showDeletedNoticeStr = await _context.SystemSettings
                    .Where(s => s.Key == "ShowDeletedMessageNotice")
                    .Select(s => s.Value)
                    .FirstOrDefaultAsync();

                bool showDeletedNotice = true;
                if (!string.IsNullOrEmpty(showDeletedNoticeStr))
                {
                    showDeletedNotice = showDeletedNoticeStr.ToLower() == "true";
                }

                // ✅ ذخیره اطلاعات قبل از حذف
                var messageIdForNotification = message.Id;
                var receiverIdForNotification = message.ReceiverId;

                if (showDeletedNotice)
                {
                    // واتساپ mode: نمایش "پیام حذف شده"
                    message.Content = null;
                    message.MessageText = null;
                    message.IsDeleted = true;
                    message.DeletedAt = DateTime.Now;

                    foreach (var attachment in message.Attachments)
                    {
                        attachment.IsDeleted = true;
                    }

                    await _context.SaveChangesAsync();
                }
                else
                {
                    // ✅ تلگرام mode: حذف کامل - اول اطلاعات را ذخیره کن
                    _context.Messages.Remove(message);
                    await _context.SaveChangesAsync();
                }

                return Ok(new
                {
                    success = true,
                    message = "پیام حذف شد",
                    showNotice = showDeletedNotice,
                    messageId = messageIdForNotification,  // ✅ اضافه کنید
                    receiverId = receiverIdForNotification  // ✅ اضافه کنید
                });
            }
            catch (Exception ex)
            {
                return StatusCode(500, new { success = false, message = ex.Message });
            }
        }

        public class DeleteMessageRequest
        {
            public int MessageId { get; set; }
        }





        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> ForwardMessages([FromBody] ForwardMessagesRequest request)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            // ✅ خواندن تنظیم نمایش نام صاحب اصلی
            var displayOriginalNameStr = await _context.SystemSettings
                .Where(s => s.Key == "DisplayOriginalNameInForward")
                .Select(s => s.Value)
                .FirstOrDefaultAsync();
            bool displayOriginalName = displayOriginalNameStr?.ToLower() == "true";

            try
            {
                var messages = await _context.Messages
                    .Include(m => m.Attachments)
                    .Include(m => m.Sender) // ✅ برای نام فرستنده
                    .Include(m => m.ForwardedFromUser) // ✅ برای نام نویسنده اصلی
                    .Where(m => request.MessageIds.Contains(m.Id))
                    .ToListAsync();

                var forwardedMessageIds = new List<int>();

                foreach (var originalMessage in messages)
                {
                    // ✅ پیدا کردن نویسنده اصلی (زنجیره فوروارد)
                    // اگر پیام قبلاً فوروارد شده، نویسنده اصلی همان ForwardedFromUserId قبلی است
                    // اگر نه، نویسنده اصلی همان SenderId است
                    var originalAuthorId = originalMessage.ForwardedFromUserId ?? originalMessage.SenderId;

                    var newMessage = new Message
                    {
                        SenderId = userId.Value,
                        ReceiverId = request.ReceiverId,
                        MessageText = originalMessage.MessageText,
                        Content = originalMessage.Content,
                        Type = originalMessage.Type,
                        SentAt = DateTime.Now,
                        IsDelivered = false,
                        IsEdited = false,
                        ForwardedFromMessageId = originalMessage.ForwardedFromMessageId ?? originalMessage.Id,
                        ForwardedFromUserId = originalAuthorId, // ✅ همیشه نویسنده اصلی
                        Attachments = originalMessage.Attachments
                            .Where(a => !a.IsDeleted)
                            .Select(a => new FileAttachment
                            {
                                FileName = a.FileName,
                                OriginalFileName = a.OriginalFileName,
                                FilePath = a.FilePath,
                                FileUrl = a.FileUrl,
                                ContentType = a.ContentType,
                                Extension = a.Extension,
                                FileSize = a.FileSize,
                                FileType = a.FileType,
                                ThumbnailPath = a.ThumbnailPath,
                                ThumbnailUrl = a.ThumbnailUrl,
                                Width = a.Width,
                                Height = a.Height,
                                Duration = a.Duration,
                                UploaderId = userId.Value,
                                CreatedAt = DateTime.Now,
                                IsDeleted = false,
                                FileHash = a.FileHash,
                                IsScanned = a.IsScanned,
                                IsSafe = a.IsSafe,
                                ScannedAt = a.ScannedAt,
                                ScanResult = a.ScanResult,
                                DownloadCount = 0,
                                LastDownloadAt = null
                            })
                            .ToList()
                    };

                    _context.Messages.Add(newMessage);
                    await _context.SaveChangesAsync();

                    forwardedMessageIds.Add(newMessage.Id);

                    // ✅ اطلاع‌رسانی Real-time به گیرنده از طریق SignalR
                    try
                    {
                        var sender = await _context.Users.FindAsync(userId.Value);
                        var receiver = await _context.Users.FindAsync(request.ReceiverId);

                        // ✅ نام نویسنده اصلی
                        string forwardedFromUserName = null;
                        if (displayOriginalName)
                        {
                            var originalAuthor = await _context.Users.FindAsync(originalAuthorId);
                            forwardedFromUserName = originalAuthor != null
                                ? $"{originalAuthor.FirstName} {originalAuthor.LastName}"
                                : null;
                        }

                        if (receiver != null)
                        {
                            var messageDto = new
                            {
                                id = newMessage.Id,
                                senderId = newMessage.SenderId,
                                senderName = sender != null
                                    ? $"{sender.FirstName} {sender.LastName}"
                                    : "کاربر",
                                senderAvatar = sender?.AvatarUrl ?? "/images/default-avatar.png",
                                content = newMessage.Content,
                                messageText = newMessage.MessageText,
                                type = newMessage.Type,
                                sentAt = newMessage.SentAt,
                                isDelivered = false,
                                isRead = false,
                                chatType = "private",
                                chatId = request.ReceiverId,
                                // ✅ اطلاعات فوروارد
                                forwardedFromMessageId = newMessage.ForwardedFromMessageId,
                                forwardedFromUserId = newMessage.ForwardedFromUserId,
                                forwardedFromUserName,
                                attachments = newMessage.Attachments.Select(a => new
                                {
                                    a.Id,
                                    a.OriginalFileName,
                                    a.FileUrl,
                                    a.ThumbnailUrl,
                                    fileType = a.FileType,
                                    a.FileSize,
                                    a.Extension,
                                    readableSize = a.ReadableFileSize,
                                    a.Width,
                                    a.Height
                                }).ToList()
                            };

                            await _hubContext.Clients.User(request.ReceiverId.ToString())
                                .SendAsync("ReceiveMessage", messageDto);
                        }
                    }
                    catch (Exception signalREx)
                    {
                        Console.WriteLine($"⚠️ SignalR notification error: {signalREx.Message}");
                    }
                }

                return Ok(new { success = true, message = "پیام‌ها ارجاع داده شدند", forwardedIds = forwardedMessageIds });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ ForwardMessages error: {ex.Message}");
                return StatusCode(500, new { success = false, message = ex.Message });
            }
        }




        public class ForwardMessagesRequest
        {
            public List<int> MessageIds { get; set; } = new();
            public int ReceiverId { get; set; }
        }




        // ============================================
        // React to Message
        // ============================================

        [HttpPost]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> ReactToMessage([FromBody] ReactToMessageRequest request)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            try
            {
                var message = await _context.Messages
                    .FirstOrDefaultAsync(m => m.Id == request.MessageId);

                if (message == null)
                    return NotFound(new { success = false, message = "پیام یافت نشد" });

                // ✅ چک کردن وجود react قبلی با همین ایموجی
                var existingReaction = await _context.MessageReactions
                    .FirstOrDefaultAsync(mr =>
                        mr.MessageId == request.MessageId &&
                        mr.UserId == userId.Value &&
                        mr.Emoji == request.Emoji);

                if (existingReaction != null)
                {
                    // ✅ همان ایموجی → toggle (حذف)
                    _context.MessageReactions.Remove(existingReaction);
                    await _context.SaveChangesAsync();

                    var updatedReactions = await GetMessageReactions(request.MessageId, userId.Value);
                    return Ok(new
                    {
                        success = true,
                        action = "removed",
                        messageId = request.MessageId,
                        emoji = request.Emoji,
                        reactions = updatedReactions
                    });
                }
                else
                {
                    // ✅ ایموجی متفاوت → حذف قبلی + اضافه جدید (در یک عملیات)
                    var oldReactions = await _context.MessageReactions
                        .Where(mr => mr.MessageId == request.MessageId && mr.UserId == userId.Value)
                        .ToListAsync();

                    if (oldReactions.Any())
                    {
                        _context.MessageReactions.RemoveRange(oldReactions);
                        // ✅ نکته کلیدی: SaveChanges نکن! همه رو یکجا ذخیره کن
                    }

                    // ✅ اضافه کردن react جدید
                    var reaction = new MessageReaction
                    {
                        MessageId = request.MessageId,
                        UserId = userId.Value,
                        Emoji = request.Emoji,
                        CreatedAt = DateTime.Now
                    };

                    _context.MessageReactions.Add(reaction);
                    await _context.SaveChangesAsync(); // ✅ حذف + اضافه یکجا

                    var updatedReactions = await GetMessageReactions(request.MessageId, userId.Value);
                    return Ok(new
                    {
                        success = true,
                        action = "added",
                        messageId = request.MessageId,
                        emoji = request.Emoji,
                        reactions = updatedReactions
                    });
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ ReactToMessage error: {ex.Message}");
                return StatusCode(500, new { success = false, message = ex.Message });
            }
        }

        // ✅ دریافت لیست reactions یک پیام
        private async Task<List<object>> GetMessageReactions(int messageId, int currentUserId)
        {
            var reactions = await _context.MessageReactions
                .Where(mr => mr.MessageId == messageId)
                .Include(mr => mr.User)
                .GroupBy(mr => mr.Emoji)
                .Select(g => new
                {
                    emoji = g.Key,
                    count = g.Count(),
                    users = g.Select(mr => new
                    {
                        id = mr.UserId,
                        name = $"{mr.User.FirstName} {mr.User.LastName}"
                    }).ToList(),
                    hasReacted = g.Any(mr => mr.UserId == currentUserId) // ✅ آیا من react زده‌ام؟
                })
                .ToListAsync();

            return reactions.Cast<object>().ToList();
        }

        // ✅ DTO
        public class ReactToMessageRequest
        {
            public int MessageId { get; set; }
            public string Emoji { get; set; } = string.Empty;
        }


        [HttpGet]
        [Route("Chat/GetMessageViewStats")]
        public async Task<IActionResult> GetMessageViewStats(int messageId)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            var message = await _context.Messages
                .Include(m => m.Sender)
                .FirstOrDefaultAsync(m => m.Id == messageId);

            if (message == null) return NotFound();

            // تعداد کل اعضا
            int totalMembers = 0;
            if (message.GroupId.HasValue)
            {
                totalMembers = await _context.UserGroups
                    .CountAsync(ug => ug.GroupId == message.GroupId && ug.IsActive);
            }
            else if (message.ChannelId.HasValue)
            {
                totalMembers = await _context.UserChannels
                    .CountAsync(uc => uc.ChannelId == message.ChannelId && uc.IsActive);
            }
            else
            {
                totalMembers = 2; // چت خصوصی: فرستنده + گیرنده
            }

            // کسانی که دیده‌اند
            var readers = await _context.MessageReads
                .Where(mr => mr.MessageId == messageId)
                .Include(mr => mr.User)
                .OrderByDescending(mr => mr.ReadAt)
                .Select(mr => new
                {
                    userId = mr.UserId,
                    name = mr.User.FirstName + " " + mr.User.LastName,
                    avatar = mr.User.AvatarUrl ?? "/images/default-avatar.png",
                    readAt = mr.ReadAt
                })
                .ToListAsync();

            // فرستنده هم خودش دیده (اضافه نکن اگه نمی‌خوای)
            var viewCount = readers.Count + 1; // +1 برای فرستنده
            var percentage = totalMembers > 0 ? Math.Round((double)viewCount / totalMembers * 100) : 0;

            return Json(new
            {
                success = true,
                messageId,
                totalMembers,
                viewCount,
                percentage,
                readers
            });
        }



        // ✅ شمارنده نخوانده‌ها برای تب‌ها
        [HttpGet]
        [Route("Chat/GetUnreadCounts")]
        public async Task<IActionResult> GetUnreadCounts()
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            // خصوصی
            var privateUnread = await _context.Messages
                .Where(m => m.ReceiverId == userId.Value &&
                            m.GroupId == null &&
                            m.ChannelId == null &&
                            !m.IsDeleted &&
                            m.SenderId != userId.Value &&
                            !_context.MessageReads.Any(mr => mr.MessageId == m.Id && mr.UserId == userId.Value))
                .CountAsync();

            // گروه‌ها
            var userGroupIds = await _context.UserGroups
                .Where(ug => ug.UserId == userId.Value && ug.IsActive)
                .Select(ug => ug.GroupId)
                .ToListAsync();

            var groupUnread = await _context.Messages
                .Where(m => m.GroupId != null &&
                            userGroupIds.Contains(m.GroupId.Value) &&
                            !m.IsDeleted &&
                            m.SenderId != userId.Value &&
                            !_context.MessageReads.Any(mr => mr.MessageId == m.Id && mr.UserId == userId.Value))
                .CountAsync();

            // کانال‌ها
            var userChannelIds = await _context.UserChannels
                .Where(uc => uc.UserId == userId.Value && uc.IsActive)
                .Select(uc => uc.ChannelId)
                .ToListAsync();

            var channelUnread = await _context.Messages
                .Where(m => m.ChannelId != null &&
                            userChannelIds.Contains(m.ChannelId.Value) &&
                            !m.IsDeleted &&
                            m.SenderId != userId.Value &&
                            !_context.MessageReads.Any(mr => mr.MessageId == m.Id && mr.UserId == userId.Value))
                .CountAsync();

            return Json(new
            {
                success = true,
                privateUnread,
                groupUnread,
                channelUnread,
                totalUnread = privateUnread + groupUnread + channelUnread
            });
        }

        // ✅ بی‌صدا / صدادار کردن گروه یا کانال
        [HttpPost]
        [Route("Chat/ToggleMute")]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> ToggleMute([FromBody] ToggleMuteRequest request)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            try
            {
                if (request.ChatType == "group")
                {
                    var membership = await _context.UserGroups
                        .FirstOrDefaultAsync(ug => ug.GroupId == request.ChatId && ug.UserId == userId.Value);

                    if (membership == null)
                        return Json(new { success = false, message = "عضو گروه نیستید" });

                    membership.IsMuted = !membership.IsMuted;
                    await _context.SaveChangesAsync();

                    return Json(new { success = true, isMuted = membership.IsMuted });
                }
                else if (request.ChatType == "channel")
                {
                    var membership = await _context.UserChannels
                        .FirstOrDefaultAsync(uc => uc.ChannelId == request.ChatId && uc.UserId == userId.Value);

                    if (membership == null)
                        return Json(new { success = false, message = "عضو کانال نیستید" });

                    membership.IsMuted = !membership.IsMuted;
                    await _context.SaveChangesAsync();

                    return Json(new { success = true, isMuted = membership.IsMuted });
                }

                return Json(new { success = false, message = "نوع چت نامعتبر" });
            }
            catch (Exception ex)
            {
                return Json(new { success = false, message = ex.Message });
            }
        }



        // ✅ دریافت تنظیمات فوروارد
        [HttpGet]
        [Route("Chat/GetForwardSettings")]
        public async Task<IActionResult> GetForwardSettings()
        {
            var displayOriginalNameStr = await _context.SystemSettings
                .Where(s => s.Key == "DisplayOriginalNameInForward")
                .Select(s => s.Value)
                .FirstOrDefaultAsync();

            return Json(new
            {
                success = true,
                displayOriginalName = displayOriginalNameStr?.ToLower() == "true"
            });
        }

    }

    public class EditMessageRequest
    {
        public int MessageId { get; set; }
        public string NewContent { get; set; } = string.Empty;
    }

    public class SendMessageRequest
    {
        public int? ReceiverId { get; set; }
        public int? GroupId { get; set; }
        public int? ChannelId { get; set; }  // ✅ برای کانال
        public string MessageText { get; set; } = string.Empty;
        public int Type { get; set; } = 0; // 0 = Text
        public int? FileAttachmentId { get; set; }
        public int? ReplyToId { get; set; }  // ✅ اضافه کنید
        public int? Duration { get; set; }   // ✅ برای فایل‌های صوتی
    }

    public class ToggleMuteRequest
    {
        public int ChatId { get; set; }
        public string ChatType { get; set; } = "";
    }


}

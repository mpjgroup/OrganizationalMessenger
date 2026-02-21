using OrganizationalMessenger.Domain.Enums;

namespace OrganizationalMessenger.Application.DTOs
{
    /// <summary>
    /// درخواست یکپارچه برای ارسال پیام
    /// </summary>
    public class SendMessageRequest
    {
        // ==================== مقصد پیام ====================

        /// <summary>
        /// نوع مقصد: Private, Group, Channel
        /// </summary>
        public MessageDestinationType DestinationType { get; set; }

        /// <summary>
        /// شناسه گیرنده (برای پیام خصوصی)
        /// </summary>
        public int? ReceiverId { get; set; }

        /// <summary>
        /// شناسه گروه (برای پیام گروهی)
        /// </summary>
        public int? GroupId { get; set; }

        /// <summary>
        /// شناسه کانال (برای پیام کانال)
        /// </summary>
        public int? ChannelId { get; set; }

        // ==================== محتوای پیام ====================

        /// <summary>
        /// متن پیام (اختیاری اگر فایل داریم)
        /// </summary>
        public string? MessageText { get; set; }

        /// <summary>
        /// نوع پیام: Text, Image, Video, Audio, File, ...
        /// </summary>
        public MessageType Type { get; set; } = MessageType.Text;

        // ==================== فایل ضمیمه ====================

        /// <summary>
        /// شناسه فایل آپلود شده
        /// </summary>
        public int? FileAttachmentId { get; set; }

        /// <summary>
        /// مدت زمان صوت/ویدیو (ثانیه)
        /// </summary>
        public int? Duration { get; set; }

        // ==================== Reply ====================

        /// <summary>
        /// شناسه پیام مرجع (برای Reply)
        /// </summary>
        public int? ReplyToMessageId { get; set; }

        // ==================== Forward ====================

        /// <summary>
        /// شناسه پیام اصلی (برای Forward)
        /// </summary>
        public int? ForwardedFromMessageId { get; set; }

        /// <summary>
        /// شناسه کاربر ارسال‌کننده اصلی (برای Forward)
        /// </summary>
        public int? ForwardedFromUserId { get; set; }

        // ==================== ویژگی‌های اضافی ====================

        /// <summary>
        /// آیا پیام فوری است؟ (برای ارسال SMS)
        /// </summary>
        public bool IsUrgent { get; set; } = false;

        /// <summary>
        /// آیا پیام سیستمی است؟
        /// </summary>
        public bool IsSystemMessage { get; set; } = false;

        // ==================== متدهای اعتبارسنجی ====================

        /// <summary>
        /// بررسی معتبر بودن درخواست
        /// </summary>
        public (bool IsValid, string? ErrorMessage) Validate()
        {
            // حداقل یک مقصد باید مشخص باشد
            if (!ReceiverId.HasValue && !GroupId.HasValue && !ChannelId.HasValue)
            {
                return (false, "مقصد پیام مشخص نیست");
            }

            // بررسی تعداد مقصدها (فقط یکی باید باشد)
            int destinationCount = 0;
            if (ReceiverId.HasValue) destinationCount++;
            if (GroupId.HasValue) destinationCount++;
            if (ChannelId.HasValue) destinationCount++;

            if (destinationCount > 1)
            {
                return (false, "نمی‌توان بیش از یک مقصد را مشخص کرد");
            }

            // حداقل یک محتوا باید وجود داشته باشد
            if (string.IsNullOrWhiteSpace(MessageText) && !FileAttachmentId.HasValue)
            {
                return (false, "محتوای پیام خالی است");
            }

            // بررسی Forward
            if (ForwardedFromMessageId.HasValue && !ForwardedFromUserId.HasValue)
            {
                return (false, "برای پیام Forward باید فرستنده اصلی مشخص باشد");
            }

            return (true, null);
        }

        /// <summary>
        /// تشخیص نوع مقصد بر اساس پارامترها
        /// </summary>
        public MessageDestinationType DetectDestinationType()
        {
            if (ReceiverId.HasValue) return MessageDestinationType.Direct;
            if (GroupId.HasValue) return MessageDestinationType.Group;
            if (ChannelId.HasValue) return MessageDestinationType.Channel;

            throw new InvalidOperationException("مقصد پیام مشخص نیست");
        }

        /// <summary>
        /// آیا پیام Reply است؟
        /// </summary>
        public bool IsReply => ReplyToMessageId.HasValue;

        /// <summary>
        /// آیا پیام Forward است؟
        /// </summary>
        public bool IsForward => ForwardedFromMessageId.HasValue;

        /// <summary>
        /// آیا پیام دارای فایل است؟
        /// </summary>
        public bool HasAttachment => FileAttachmentId.HasValue;
    }
}

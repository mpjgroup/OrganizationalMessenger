using OrganizationalMessenger.Application.DTOs;
using OrganizationalMessenger.Domain.Entities;

namespace OrganizationalMessenger.Application.Interfaces
{
    /// <summary>
    /// سرویس یکپارچه مدیریت پیام‌ها
    /// </summary>
    public interface IMessageService
    {
        /// <summary>
        /// ارسال یکپارچه پیام
        /// </summary>
        /// <param name="request">درخواست ارسال پیام</param>
        /// <param name="senderId">شناسه فرستنده</param>
        /// <returns>پیام ایجاد شده</returns>
        Task<(bool Success, Message? Message, string? ErrorMessage)> SendMessageAsync(
            SendMessageRequest request,
            int senderId);

        /// <summary>
        /// بررسی مجوزهای ارسال پیام
        /// </summary>
        Task<(bool HasPermission, string? DenyReason)> CheckSendPermissionAsync(
            SendMessageRequest request,
            int senderId);

        /// <summary>
        /// اعتبارسنجی محتوای پیام (کلمات ممنوعه و...)
        /// </summary>
        Task<(bool IsValid, string? Reason)> ValidateContentAsync(string? content);

        /// <summary>
        /// دریافت لیست گیرندگان پیام
        /// </summary>
        Task<List<int>> GetRecipientsAsync(SendMessageRequest request);

        /// <summary>
        /// ارسال نوتیفیکیشن‌های سیستمی
        /// </summary>
        Task SendNotificationsAsync(Message message, List<int> recipientIds);
    }
}

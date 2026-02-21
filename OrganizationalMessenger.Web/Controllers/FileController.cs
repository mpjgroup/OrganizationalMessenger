using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OrganizationalMessenger.Domain.Entities;
using OrganizationalMessenger.Infrastructure.Data;
using OrganizationalMessenger.Infrastructure.Services;
using OrganizationalMessenger.Web.Services;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;
using System.Security.Claims;

namespace OrganizationalMessenger.Web.Controllers
{
    [Authorize]
    [Route("api/[controller]")]
    [ApiController]
    public class FileController : ControllerBase
    {
        private readonly ApplicationDbContext _context;
        private readonly IWebHostEnvironment _env;
        private readonly IAudioConverterService _audioConverter;


        public FileController(ApplicationDbContext context, IWebHostEnvironment env, IAudioConverterService audioConverter)
        {
            _context = context;
            _env = env;
            _audioConverter = audioConverter;
        }

        /// <summary>
        /// ✅ آپلود فایل - بدون MessageId
        /// </summary>
        [HttpPost("upload")]
        public async Task<IActionResult> UploadFile(
            IFormFile file,
            [FromForm] string? caption = null,
            [FromForm] int? duration = null)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            if (file == null || file.Length == 0)
                return BadRequest(new { success = false, message = "فایلی انتخاب نشده است" });

            var extension = Path.GetExtension(file.FileName).ToLower().TrimStart('.');
            var contentType = file.ContentType;

            // ✅ تشخیص دسته‌بندی
            string category = "document";
            if (duration.HasValue && duration.Value > 0)
            {
                category = "audio";
                Console.WriteLine($"🎤 Voice message detected: duration={duration}s");
            }
            else if (contentType.StartsWith("image/"))
            {
                category = "image";
            }
            else if (contentType.StartsWith("video/"))
            {
                category = "video";
            }

            // ✅ بررسی مجوز فایل
            var uploadSetting = await _context.FileUploadSettings
                .FirstOrDefaultAsync(f => f.FileType.ToLower() == extension && f.IsAllowed);

            if (uploadSetting == null)
                return BadRequest(new { success = false, message = $"فرمت .{extension} مجاز نیست" });

            if (file.Length > uploadSetting.MaxSize)
            {
                var maxSizeMB = uploadSetting.MaxSize / (1024.0 * 1024.0);
                return BadRequest(new { success = false, message = $"حجم فایل نباید بیشتر از {maxSizeMB:0.##} MB باشد" });
            }

            try
            {
                // ✅ مسیر ذخیره‌سازی
                var subFolder = category.ToLower();
                var uploadsPath = Path.Combine(_env.WebRootPath, "uploads", subFolder);
                if (!Directory.Exists(uploadsPath))
                    Directory.CreateDirectory(uploadsPath);

                var fileName = $"{Guid.NewGuid()}{Path.GetExtension(file.FileName)}";
                var fullPath = Path.Combine(uploadsPath, fileName);
                var relativePath = $"/uploads/{subFolder}/{fileName}";

                // ✅ ذخیره فایل
                using (var stream = new FileStream(fullPath, FileMode.Create))
                {
                    await file.CopyToAsync(stream);
                }

                Console.WriteLine($"✅ File saved: {fullPath}");

                // ✅ تبدیل webm به mp3 برای سازگاری با Safari/iOS
                if (category == "audio" && extension == "webm")
                {
                    var convertedPath = await _audioConverter.ConvertToMp3Async(fullPath, uploadsPath);

                    if (convertedPath != fullPath) // تبدیل موفق بود
                    {
                        var convertedFileName = Path.GetFileName(convertedPath);
                        fullPath = convertedPath;
                        fileName = convertedFileName;
                        relativePath = $"/uploads/{subFolder}/{convertedFileName}";
                        extension = "mp3";
                        contentType = "audio/mpeg";

                        Console.WriteLine($"✅ Audio converted: webm → mp3");
                    }
                }





                // ✅ Thumbnail برای تصاویر
                string? thumbnailUrl = null;
                int? width = null, height = null;

                if (category == "image")
                {
                    try
                    {
                        using var image = await SixLabors.ImageSharp.Image.LoadAsync(fullPath);
                        width = image.Width;
                        height = image.Height;

                        var thumbDir = Path.Combine(uploadsPath, "thumbs");
                        Directory.CreateDirectory(thumbDir);

                        var thumbFileName = $"thumb_{fileName}";
                        var thumbnailPath = Path.Combine(thumbDir, thumbFileName);

                        var clone = image.Clone(x => x.Resize(new ResizeOptions
                        {
                            Size = new Size(300, 300),
                            Mode = ResizeMode.Max
                        }));

                        await clone.SaveAsJpegAsync(thumbnailPath, new JpegEncoder { Quality = 80 });
                        thumbnailUrl = $"/uploads/{subFolder}/thumbs/{thumbFileName}";
                        Console.WriteLine($"✅ Thumbnail created: {thumbnailUrl}");
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"❌ Thumbnail error: {ex.Message}");
                    }
                }

                // ✅ Hash فایل
                string? fileHash = null;
                try
                {
                    using var sha256 = System.Security.Cryptography.SHA256.Create();
                    using var fileStream = System.IO.File.OpenRead(fullPath);
                    var hashBytes = await sha256.ComputeHashAsync(fileStream);
                    fileHash = BitConverter.ToString(hashBytes).Replace("-", "").ToLower();
                }
                catch { }

                // ✅ ثبت در دیتابیس - بدون MessageId
                var fileAttachment = new FileAttachment
                {
                    FileName = fileName,
                    OriginalFileName = file.FileName,
                    FilePath = fullPath,
                    FileUrl = relativePath,
                    ContentType = contentType,
                    Extension = extension,
                    FileSize = file.Length,
                    FileType = CapitalizeFirst(category), // Image, Video, Audio, Document
                    ThumbnailUrl = thumbnailUrl,
                    Width = width,
                    Height = height,
                    Duration = duration,
                    UploaderId = userId.Value,
                    MessageId = null, // ✅ هنوز پیام ساخته نشده
                    CreatedAt = DateTime.Now,
                    FileHash = fileHash,
                    IsSafe = true,
                    IsScanned = false
                };

                _context.FileAttachments.Add(fileAttachment);
                await _context.SaveChangesAsync();

                Console.WriteLine($"✅ FileAttachment created: ID={fileAttachment.Id}, Type={fileAttachment.FileType}");

                return Ok(new
                {
                    success = true,
                    file = new
                    {
                        id = fileAttachment.Id,
                        fileName = fileAttachment.FileName,
                        originalFileName = fileAttachment.OriginalFileName,
                        fileUrl = fileAttachment.FileUrl,
                        thumbnailUrl = fileAttachment.ThumbnailUrl,
                        fileType = fileAttachment.FileType,
                        fileSize = fileAttachment.FileSize,
                        width = fileAttachment.Width,
                        height = fileAttachment.Height,
                        extension = fileAttachment.Extension,
                        duration = fileAttachment.Duration,
                        readableSize = fileAttachment.ReadableFileSize,
                        readableDuration = fileAttachment.ReadableDuration
                    },
                    caption
                });
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ Upload error: {ex.Message}");
                return StatusCode(500, new { success = false, message = $"خطا در آپلود فایل: {ex.Message}" });
            }
        }

        /// <summary>
        /// ✅ دانلود فایل
        /// </summary>
        [HttpGet("download/{id}")]
        public async Task<IActionResult> DownloadFile(int id)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            var file = await _context.FileAttachments
                .FirstOrDefaultAsync(f => f.Id == id && !f.IsDeleted);

            if (file == null)
                return NotFound(new { success = false, message = "فایل یافت نشد" });

            if (!file.IsSafe)
                return BadRequest(new { success = false, message = "این فایل امن نیست" });

            if (!System.IO.File.Exists(file.FilePath))
                return NotFound(new { success = false, message = "فایل فیزیکی یافت نشد" });

            file.IncrementDownloadCount();
            await _context.SaveChangesAsync();

            var memory = new MemoryStream();
            using (var stream = new FileStream(file.FilePath, FileMode.Open))
            {
                await stream.CopyToAsync(stream);
            }
            memory.Position = 0;

            return base.File(memory, file.ContentType ?? "application/octet-stream", file.OriginalFileName);
        }

        /// <summary>
        /// ✅ حذف فایل (soft delete)
        /// </summary>
        [HttpDelete("delete/{id}")]
        public async Task<IActionResult> DeleteFile(int id)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            var file = await _context.FileAttachments
                .FirstOrDefaultAsync(f => f.Id == id && f.UploaderId == userId.Value && !f.IsDeleted);

            if (file == null)
                return NotFound(new { success = false, message = "فایل یافت نشد" });

            file.MarkAsDeleted();
            await _context.SaveChangesAsync();

            return Ok(new { success = true, message = "فایل حذف شد" });
        }

        // ========== متدهای کمکی ==========

        private int? GetCurrentUserId()
        {
            var claim = User.FindFirst(ClaimTypes.NameIdentifier);
            if (claim == null) return null;
            return int.TryParse(claim.Value, out var id) ? id : null;
        }

        private string CapitalizeFirst(string text)
        {
            if (string.IsNullOrEmpty(text)) return text;
            return char.ToUpper(text[0]) + text.Substring(1).ToLower();
        }
    }
}
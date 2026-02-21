using Microsoft.Extensions.Logging;
using System.Diagnostics;


namespace OrganizationalMessenger.Web.Services
{
    public interface IAudioConverterService
    {
        Task<string> ConvertToMp3Async(string inputPath, string outputDirectory);
    }

    public class AudioConverterService : IAudioConverterService
    {
        private readonly ILogger<AudioConverterService> _logger;
        private readonly string _ffmpegPath;

        public AudioConverterService(
            ILogger<AudioConverterService> logger,
            IWebHostEnvironment env)
        {
            _logger = logger;

            // ✅ اول چک کن ffmpeg توی فولدر Tools پروژه هست
            var localPath = Path.Combine(env.ContentRootPath, "Tools", "ffmpeg.exe");
            if (File.Exists(localPath))
            {
                _ffmpegPath = localPath;
                _logger.LogInformation($"✅ FFmpeg found: {localPath}");
            }
            else
            {
                // ✅ اگه نبود، فرض کن توی PATH سیستم هست
                _ffmpegPath = "ffmpeg";
                _logger.LogWarning("⚠️ FFmpeg not found in Tools folder, using system PATH");
            }
        }

        public async Task<string> ConvertToMp3Async(string inputPath, string outputDirectory)
        {
            var outputFileName = Path.GetFileNameWithoutExtension(inputPath) + ".mp3";
            var outputPath = Path.Combine(outputDirectory, outputFileName);

            try
            {
                _logger.LogInformation($"🔄 Converting: {inputPath} → {outputPath}");
                _logger.LogInformation($"🔧 Using FFmpeg: {_ffmpegPath}");

                var process = new Process
                {
                    StartInfo = new ProcessStartInfo
                    {
                        FileName = _ffmpegPath,
                        Arguments = $"-i \"{inputPath}\" -codec:a libmp3lame -qscale:a 4 -y \"{outputPath}\"",
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                        UseShellExecute = false,
                        CreateNoWindow = true
                    }
                };

                process.Start();

                // خواندن خروجی برای جلوگیری از deadlock
                var errorOutput = await process.StandardError.ReadToEndAsync();
                await process.WaitForExitAsync();

                if (process.ExitCode != 0)
                {
                    _logger.LogError($"❌ FFmpeg failed (exit code {process.ExitCode}): {errorOutput}");
                    return inputPath; // فایل اصلی webm رو برگردون
                }

                // ✅ بررسی ایجاد فایل mp3
                if (!File.Exists(outputPath))
                {
                    _logger.LogError("❌ MP3 file was not created");
                    return inputPath;
                }

                // ✅ حذف فایل webm اصلی
                if (File.Exists(inputPath))
                {
                    File.Delete(inputPath);
                    _logger.LogInformation($"🗑️ Original webm deleted: {inputPath}");
                }

                _logger.LogInformation($"✅ Converted successfully: {outputPath} ({new FileInfo(outputPath).Length / 1024} KB)");
                return outputPath;
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                _logger.LogError($"❌ FFmpeg not found! Path: {_ffmpegPath}");
                _logger.LogError($"   Download from: https://www.gyan.dev/ffmpeg/builds/");
                _logger.LogError($"   Place ffmpeg.exe in: Tools/ffmpeg.exe");
                return inputPath;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "❌ Audio conversion error");
                return inputPath;
            }
        }
    }
}
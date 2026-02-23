using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OrganizationalMessenger.Domain.Entities;
using OrganizationalMessenger.Domain.Enums;
using OrganizationalMessenger.Infrastructure.Data;
using System.Globalization;
using System.Security.Claims;

namespace OrganizationalMessenger.Web.Controllers
{
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class PollController : ControllerBase
    {
        private readonly ApplicationDbContext _context;

        public PollController(ApplicationDbContext context)
        {
            _context = context;
        }


        [HttpPost("Create")]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Create([FromBody] CreatePollRequest request)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            DateTime? expires = null;
            if (request.PollType == "closed")
            {
                if (string.IsNullOrWhiteSpace(request.ExpiresAt))
                    return BadRequest(new { success = false, message = "لطفاً تاریخ پایان نظرسنجی را مشخص کنید" });

                if (!DateTime.TryParseExact(
                        request.ExpiresAt,
                        "yyyy-MM-ddTHH:mm",
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.AssumeLocal,  // یعنی همین زمان را لوکال در نظر بگیر
                        out var exp))
                {
                    return BadRequest(new { success = false, message = "فرمت تاریخ پایان معتبر نیست" });
                }

                expires = exp;
            }

            var poll = new Poll
            {
                Question = request.Question.Trim(),
                CreatorId = userId.Value,
                GroupId = request.GroupId,
                ChannelId = request.ChannelId,
                AllowMultipleAnswers = request.AllowMultipleAnswers,
                IsAnonymous = false,
                IsActive = true,
                ExpiresAt = expires,
                CreatedAt = DateTime.Now
            };


            _context.Polls.Add(poll);
            await _context.SaveChangesAsync();

            for (int i = 0; i < request.Options.Count; i++)
            {
                var option = new PollOption
                {
                    PollId = poll.Id,
                    Text = request.Options[i].Trim(),
                    DisplayOrder = i
                };
                _context.PollOptions.Add(option);
            }
            await _context.SaveChangesAsync();

            var message = new Message
            {
                SenderId = userId.Value,
                GroupId = request.GroupId,
                ChannelId = request.ChannelId,
                Content = $"📊 نظرسنجی: {poll.Question}",
                MessageText = $"📊 نظرسنجی: {poll.Question}",
                Type = MessageType.Poll,
                SentAt = DateTime.Now,  // ✅ Local نه UTC
                IsDelivered = false,
                PollId = poll.Id
            };

            _context.Messages.Add(message);
            await _context.SaveChangesAsync();

            return Ok(new { success = true, pollId = poll.Id, messageId = message.Id });
        }


        [HttpPost("Vote")]
        [ValidateAntiForgeryToken]
        public async Task<IActionResult> Vote([FromBody] VotePollRequest request)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            var option = await _context.PollOptions
                .Include(o => o.Poll)
                .FirstOrDefaultAsync(o => o.Id == request.OptionId);

            if (option == null)
                return NotFound(new { success = false, message = "گزینه یافت نشد" });

            // ✅ چک فعال بودن + expire
            // ✅ چک فعال بودن + expire
            if (!option.Poll.IsActive)
                return BadRequest(new { success = false, message = "نظرسنجی پایان یافته است" });

            if (option.Poll.ExpiresAt.HasValue && DateTime.Now >= option.Poll.ExpiresAt.Value)
            {
                // ✅ poll data هم برگردون تا UI آپدیت بشه و نشون بده بسته شده
                var expiredPoll = await GetPollData(option.PollId, userId.Value);
                return Ok(new { success = false, message = "مهلت نظرسنجی به پایان رسیده است", poll = expiredPoll });
            }
            // چک رأی تکراری
            var existingVote = await _context.PollVotes
                .FirstOrDefaultAsync(v => v.PollOptionId == request.OptionId && v.UserId == userId.Value);

            if (existingVote != null)
            {
                // حذف رأی (toggle)
                _context.PollVotes.Remove(existingVote);
            }
            else
            {
                // اگه چند انتخابی نیست، رأی قبلی رو حذف کن
                if (!option.Poll.AllowMultipleAnswers)
                {
                    var previousVotes = await _context.PollVotes
                        .Where(v => v.PollOption.PollId == option.PollId && v.UserId == userId.Value)
                        .ToListAsync();
                    _context.PollVotes.RemoveRange(previousVotes);
                }

                _context.PollVotes.Add(new PollVote
                {
                    PollOptionId = request.OptionId,
                    UserId = userId.Value,
                    VotedAt = DateTime.Now
                });
            }

            await _context.SaveChangesAsync();

            // برگشت نتایج آپدیت شده
            var poll = await GetPollData(option.PollId, userId.Value);
            return Ok(new { success = true, poll });
        }

        [HttpGet("{pollId}")]
        public async Task<IActionResult> GetPoll(int pollId)
        {
            var userId = GetCurrentUserId();
            if (userId == null) return Unauthorized();

            var poll = await GetPollData(pollId, userId.Value);
            if (poll == null) return NotFound();

            return Ok(new { success = true, poll });
        }


        //private async Task<object?> GetPollData(int pollId, int userId)
        //{
        //    var poll = await _context.Polls
        //        .Include(p => p.Options)
        //            .ThenInclude(o => o.Votes)
        //                .ThenInclude(v => v.User)
        //        .FirstOrDefaultAsync(p => p.Id == pollId);

        //    if (poll == null) return null;

        //    // ⬅️ لاگ مهم برای دیباگ
        //    Console.WriteLine($"[POLL] Id={poll.Id} ExpiresAt DB={poll.ExpiresAt:O}");

        //    bool isExpired = poll.ExpiresAt.HasValue && DateTime.Now >= poll.ExpiresAt.Value;
        //    bool isActive = poll.IsActive && !isExpired;
        //    string pollType = poll.ExpiresAt.HasValue ? "closed" : "open";

        //    var expiresAtString = poll.ExpiresAt?.ToString("yyyy-MM-ddTHH:mm:ss");
        //    Console.WriteLine($"[POLL] Id={poll.Id} ExpiresAt JSON={expiresAtString}");


        //    var rawPoll = await _context.Polls.AsNoTracking()
        //        .FirstOrDefaultAsync(p => p.Id == pollId);


        //    return new
        //    {
        //        id = poll.Id,
        //        question = poll.Question,
        //        isActive = isActive,
        //        allowMultipleAnswers = poll.AllowMultipleAnswers,
        //        pollType = pollType,
        //        createdAt = poll.CreatedAt,
        //        expiresAt = "2026-02-23T11:30:00",

        //        options = poll.Options.OrderBy(o => o.DisplayOrder).Select(o => new
        //        {
        //            id = o.Id,
        //            text = o.Text,
        //            voteCount = o.Votes.Count,
        //            hasVoted = o.Votes.Any(v => v.UserId == userId),
        //            voters = o.Votes.Select(v => new
        //            {
        //                id = v.UserId,
        //                name = v.User.FullName,
        //                avatar = v.User.AvatarUrl
        //            })
        //        })
        //    };
        //}

        private async Task<object?> GetPollData(int pollId, int userId)
        {
            var poll = await _context.Polls
                .Include(p => p.Options)
                    .ThenInclude(o => o.Votes)
                        .ThenInclude(v => v.User)
                .FirstOrDefaultAsync(p => p.Id == pollId);

            if (poll == null) return null;

            bool isExpired = poll.ExpiresAt.HasValue && DateTime.Now >= poll.ExpiresAt.Value;
            bool isActive = poll.IsActive && !isExpired;
            string pollType = poll.ExpiresAt.HasValue ? "closed" : "open";

            return new
            {
                id = poll.Id,
                question = poll.Question,
                isActive = isActive,
                allowMultipleAnswers = poll.AllowMultipleAnswers,
                pollType = pollType,
                createdAt = poll.CreatedAt,
                // ✅ ExpiresAt بدون تبدیل - مستقیم ISO فرمت
                expiresAt = poll.ExpiresAt?.ToString("yyyy-MM-ddTHH:mm:ss"),
                options = poll.Options.OrderBy(o => o.DisplayOrder).Select(o => new
                {
                    id = o.Id,
                    text = o.Text,
                    voteCount = o.Votes.Count,
                    hasVoted = o.Votes.Any(v => v.UserId == userId),
                    voters = o.Votes.Select(v => new
                    {
                        id = v.UserId,
                        name = v.User.FullName,
                        avatar = v.User.AvatarUrl
                    })
                })
            };
        }


        private int? GetCurrentUserId()
        {
            var claim = User.FindFirst(ClaimTypes.NameIdentifier);
            return claim != null ? int.Parse(claim.Value) : null;
        }
    }

    public class CreatePollRequest
    {
        public string Question { get; set; } = "";
        public List<string> Options { get; set; } = new();
        public string PollType { get; set; } = "open";
        public bool AllowMultipleAnswers { get; set; }
        public int? GroupId { get; set; }
        public int? ChannelId { get; set; }
        public string? ExpiresAt { get; set; }
        // ✅ اضافه شد

    }

    public class VotePollRequest
    {
        public int PollId { get; set; }
        public int OptionId { get; set; }
    }
}
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OrganizationalMessenger.Domain.Entities;
using OrganizationalMessenger.Domain.Enums;
using OrganizationalMessenger.Infrastructure.Data;
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

            if (string.IsNullOrWhiteSpace(request.Question))
                return BadRequest(new { success = false, message = "سوال نظرسنجی الزامی است" });

            if (request.Options == null || request.Options.Count < 2)
                return BadRequest(new { success = false, message = "حداقل ۲ گزینه لازم است" });

            // ✅ نظرسنجی بسته باید تاریخ پایان داشته باشه
            if (request.PollType == "closed" && !request.ExpiresAt.HasValue)
                return BadRequest(new { success = false, message = "لطفاً تاریخ پایان نظرسنجی را مشخص کنید" });

            var poll = new Poll
            {
                Question = request.Question.Trim(),
                CreatorId = userId.Value,
                GroupId = request.GroupId,
                ChannelId = request.ChannelId,
                AllowMultipleAnswers = request.AllowMultipleAnswers,
                IsAnonymous = false,
                IsActive = true,  // ✅ همیشه فعاله! (بسته هم فعاله تا ExpiresAt)
                ExpiresAt = request.PollType == "closed" ? request.ExpiresAt : null,
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


            // ✅ ایجاد پیام مرتبط با نظرسنجی
            var message = new Message
            {
                SenderId = userId.Value,
                GroupId = request.GroupId,
                ChannelId = request.ChannelId,
                Content = $"📊 نظرسنجی: {poll.Question}",
                MessageText = $"📊 نظرسنجی: {poll.Question}",
                Type = MessageType.Poll,
                SentAt = DateTime.UtcNow,
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

            if (!option.Poll.IsActive)
                return BadRequest(new { success = false, message = "نظرسنجی پایان یافته است" });

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



        private async Task<object?> GetPollData(int pollId, int userId)
        {
            var poll = await _context.Polls
                .Include(p => p.Options)
                    .ThenInclude(o => o.Votes)
                        .ThenInclude(v => v.User)
                .FirstOrDefaultAsync(p => p.Id == pollId);

            if (poll == null) return null;

            // ✅ چک ExpiresAt - اگه زمان گذشته، غیرفعال کن
            bool isExpired = poll.ExpiresAt.HasValue && DateTime.Now >= poll.ExpiresAt.Value;
            bool isActive = poll.IsActive && !isExpired;

            // ✅ نوع: اگه ExpiresAt داره → بسته (closed)
            string pollType = poll.ExpiresAt.HasValue ? "closed" : "open";

            return new
            {
                id = poll.Id,
                question = poll.Question,
                isActive = isActive,
                allowMultipleAnswers = poll.AllowMultipleAnswers,
                pollType = pollType,
                createdAt = poll.CreatedAt,
                expiresAt = poll.ExpiresAt,  // ✅ اضافه شد
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
        public DateTime? ExpiresAt { get; set; }  // ✅ اضافه شد

    }

    public class VotePollRequest
    {
        public int PollId { get; set; }
        public int OptionId { get; set; }
    }
}
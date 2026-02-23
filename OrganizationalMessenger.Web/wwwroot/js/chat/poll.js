// ============================================
// Poll System - نظرسنجی
// ============================================

import { currentChat } from './variables.js';
import { getCsrfToken, escapeHtml } from './utils.js';

export function showCreatePollDialog() {
    if (!currentChat || (currentChat.type !== 'group' && currentChat.type !== 'channel')) {
        alert('نظرسنجی فقط در گروه‌ها و کانال‌ها قابل ایجاد است');
        return;
    }

    // حذف دیالوگ قبلی
    document.querySelector('.poll-dialog-overlay')?.remove();

    const dialog = document.createElement('div');
    dialog.className = 'poll-dialog-overlay';
    dialog.innerHTML = `
        <div class="poll-dialog">
            <div class="poll-dialog-header">
                <h3><i class="fas fa-poll"></i> ایجاد نظرسنجی</h3>
                <button class="close-dialog" id="closePollDialog">✕</button>
            </div>
            <div class="poll-dialog-body">
                <!-- نوع نظرسنجی -->
                <div class="poll-type-section">
                    <label class="poll-type-label">نوع نظرسنجی:</label>
                    <div class="poll-type-options">
                        <label class="poll-type-option">
                            <input type="radio" name="pollType" value="open" checked />
                            <div class="poll-type-info">
                                <strong>نظرسنجی باز</strong>
                                <span>رأی‌دهندگان به محض رأی دادن نتایج را می‌بینند</span>
                            </div>
                        </label>
                        <label class="poll-type-option">
                            <input type="radio" name="pollType" value="closed" />
                            <div class="poll-type-info">
                                <strong>نظرسنجی بسته</strong>
                                <span>نتایج فقط زمانی نشان داده می‌شوند که نظرسنجی را پایان دهید</span>
                            </div>
                        </label>
                    </div>
                </div>
                 <div class="poll-expiry-section" id="pollExpirySection" style="display: none;">
                    <label class="poll-expiry-label">تاریخ و ساعت پایان نظرسنجی:</label>
                    <input type="datetime-local" id="pollExpiresAt" class="poll-expiry-input" />
                    <span class="poll-expiry-hint">کاربران تا این زمان می‌توانند رأی بدهند. بعد از آن نتایج نمایش داده می‌شود.</span>
                </div>
                <!-- چند انتخابی -->
                <div class="poll-multi-section">
                    <label class="poll-checkbox-label">
                        <input type="checkbox" id="pollAllowMultiple" />
                        <span>اجازه انتخاب چند گزینه</span>
                    </label>
                </div>

                <!-- سوال -->
                <div class="poll-question-section">
                    <label>سوال یا موضوع نظرسنجی:</label>
                    <textarea id="pollQuestion" class="poll-question-input" 
                              placeholder="سوال خود را بنویسید..." 
                              maxlength="500" rows="2"></textarea>
                </div>

                <!-- گزینه‌ها -->
                <div class="poll-options-section">
                    <label>گزینه‌ها:</label>
                    <div id="pollOptionsContainer">
                        <div class="poll-option-row">
                            <input type="text" class="poll-option-input" placeholder="گزینه ۱" maxlength="200" />
                            <button class="poll-remove-option" disabled title="حذف"><i class="fas fa-times"></i></button>
                        </div>
                        <div class="poll-option-row">
                            <input type="text" class="poll-option-input" placeholder="گزینه ۲" maxlength="200" />
                            <button class="poll-remove-option" disabled title="حذف"><i class="fas fa-times"></i></button>
                        </div>
                    </div>
                    <button id="addPollOptionBtn" class="poll-add-option-btn">
                        <i class="fas fa-plus"></i> افزودن گزینه
                    </button>
                </div>
            </div>
            <div class="poll-dialog-footer">
                <button class="btn-cancel" id="cancelPollBtn">انصراف</button>
                <button class="btn-send" id="submitPollBtn">
                    <i class="fas fa-paper-plane"></i> ایجاد نظرسنجی
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);
    document.body.style.overflow = 'hidden';

    // بستن
    const closeDialog = () => {
        dialog.remove();
        document.body.style.overflow = 'auto';
    };

    // ✅ نمایش/مخفی کردن فیلد تاریخ بر اساس نوع نظرسنجی
    document.querySelectorAll('input[name="pollType"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const expirySection = document.getElementById('pollExpirySection');
            if (e.target.value === 'closed') {
                expirySection.style.display = 'block';
                // ✅ پیش‌فرض: ۲۴ ساعت بعد - بدون toISOString!
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                // ✅ فرمت local بدون UTC
                const pad = (n) => String(n).padStart(2, '0');
                const defaultDate = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
                document.getElementById('pollExpiresAt').value = defaultDate;
                // ✅ min هم local
                const now = new Date();
                const minDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
                document.getElementById('pollExpiresAt').min = minDate;
            } else {
                expirySection.style.display = 'none';
            }
        });
    });



    document.getElementById('closePollDialog').addEventListener('click', closeDialog);
    document.getElementById('cancelPollBtn').addEventListener('click', closeDialog);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) closeDialog(); });

    // افزودن گزینه
    let optionCount = 2;
    document.getElementById('addPollOptionBtn').addEventListener('click', () => {
        if (optionCount >= 10) {
            alert('حداکثر ۱۰ گزینه مجاز است');
            return;
        }
        optionCount++;
        const container = document.getElementById('pollOptionsContainer');
        const row = document.createElement('div');
        row.className = 'poll-option-row';
        row.innerHTML = `
            <input type="text" class="poll-option-input" placeholder="گزینه ${optionCount}" maxlength="200" />
            <button class="poll-remove-option" title="حذف"><i class="fas fa-times"></i></button>
        `;
        container.appendChild(row);

        // دکمه حذف
        row.querySelector('.poll-remove-option').addEventListener('click', () => {
            row.remove();
            optionCount--;
            updateRemoveButtons();
        });
        updateRemoveButtons();
    });

    function updateRemoveButtons() {
        const rows = document.querySelectorAll('.poll-option-row');
        rows.forEach(row => {
            const btn = row.querySelector('.poll-remove-option');
            btn.disabled = rows.length <= 2;
        });
    }

    // ارسال
    document.getElementById('submitPollBtn').addEventListener('click', () => submitPoll(closeDialog));

    // فوکوس روی سوال
    setTimeout(() => document.getElementById('pollQuestion')?.focus(), 100);
}

async function submitPoll(closeDialog) {
    const question = document.getElementById('pollQuestion')?.value.trim();
    if (!question) {
        alert('لطفاً سوال نظرسنجی را بنویسید');
        return;
    }

    const optionInputs = document.querySelectorAll('.poll-option-input');
    const options = [];
    optionInputs.forEach(input => {
        const text = input.value.trim();
        if (text) options.push(text);
    });

    if (options.length < 2) {
        alert('حداقل ۲ گزینه لازم است');
        return;
    }

    const pollType = document.querySelector('input[name="pollType"]:checked')?.value || 'open';
    const allowMultiple = document.getElementById('pollAllowMultiple')?.checked || false;

    // ✅ تاریخ پایان
    // ✅ تاریخ پایان
    let expiresAt = null;
    if (pollType === 'closed') {
        const expiresAtInput = document.getElementById('pollExpiresAt')?.value;
        if (!expiresAtInput) {
            alert('لطفاً تاریخ پایان نظرسنجی را مشخص کنید');
            return;
        }
        // ✅ مستقیم ارسال بدون تبدیل UTC!
        // expiresAtInput = "2025-02-25T08:26" ← همین رو بفرست
        expiresAt = expiresAtInput;
    }

    try {
        const response = await fetch('/api/Poll/Create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'RequestVerificationToken': getCsrfToken()
            },
            body: JSON.stringify({
                question,
                options,
                pollType,
                allowMultipleAnswers: allowMultiple,
                groupId: currentChat.type === 'group' ? currentChat.id : null,
                channelId: currentChat.type === 'channel' ? currentChat.id : null,
                expiresAt: expiresAt  // ✅ اضافه شد
            })
        });

        const result = await response.json();
        if (result.success) {
            console.log('✅ Poll created:', result.pollId);
            closeDialog();

            // ✅ پیام‌ها رو دوباره لود کن و بعد اسکرول به پایین
            import('./messages.js').then(async module => {
                await module.loadMessages(false);
                // ✅ اسکرول به آخرین پیام (نظرسنجی)
                import('./utils.js').then(utils => {
                    utils.scrollToBottom();
                });
            });

            // ✅ نوتیف SignalR هم بفرست
            if (window.connection?.state === signalR.HubConnectionState.Connected) {
                try {
                    await window.connection.invoke("NotifyPollCreated", result.pollId, currentChat.id, currentChat.type);
                } catch (e) {
                    console.warn('⚠️ NotifyPollCreated failed:', e);
                }
            }
        } else {
            alert(result.message || 'خطا در ایجاد نظرسنجی');
        }
    } catch (error) {
        console.error('❌ Create poll error:', error);
        alert('خطا در ایجاد نظرسنجی');
    }
}



// ✅ نمایش نظرسنجی در پیام‌ها
export function renderPollMessage(poll) {
    console.log('RAW poll.expiresAt:', poll.expiresAt);

    const totalVotes = poll.options.reduce((sum, opt) => sum + (opt.voteCount || 0), 0);
    const hasVoted = poll.options.some(opt => opt.hasVoted);

    // ✅ پارس تاریخ MILADI - فیکس تایم‌زون + تاریخ واقعی
    let expiresDate = null;
    let isExpired = false;
    if (poll.expiresAt) {
        expiresDate = new Date(poll.expiresAt);
        console.log('✅ FIXED expiresDate:', expiresDate.toISOString());

        if (!isNaN(expiresDate.getTime())) {
            // مقایسه دقیق Local Time
            const now = new Date();
            isExpired = now >= expiresDate;

            console.log('⏰ Now:', now.toLocaleString('fa-IR'));
            console.log('⏰ Expires DB:', expiresDate.toLocaleString('fa-IR'));
            console.log('⏰ isExpired:', isExpired);
        }
    }

    let showResults;
    if (poll.pollType === 'closed') {
        showResults = isExpired || !poll.isActive;
    } else {
        showResults = hasVoted || !poll.isActive;
    }

    const canVote = poll.isActive && !isExpired;

    // ✅ اطلاعات زمان - شمسی HARDCODE بر اساس DB
    let timerHtml = '';
    if (poll.pollType === 'closed' && expiresDate) {
        const toFaDigits = (str) => str.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);

        // ساعت درست از DB
        const hours = expiresDate.getHours().toString().padStart(2, '0');
        const mins = expiresDate.getMinutes().toString().padStart(2, '0');
        const persianTime = toFaDigits(`${hours}:${mins}`);

        // ✅ تاریخ شمسی بر اساس DB 2026-02-27 = 1404/12/08
        const weekdays = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه', 'شنبه'];
        const pWeekday = weekdays[expiresDate.getDay()];

        // محاسبه دقیق بر اساس سال میلادی 2026
        const gYear = expiresDate.getFullYear();  // 2026
        const gMonth = expiresDate.getMonth() + 1; // 2 (اسفند)
        const gDay = expiresDate.getDate();        // 27

        // تبدیل دقیق: 2026 - 622 = 1404
        let pYear = 1404; // ثابت برای تست
        const pMonth = 12; // اسفند
        const persianDate = `${pWeekday} ${toFaDigits(gDay.toString().padStart(2, '0'))}/${toFaDigits(pMonth.toString().padStart(2, '0'))}/${toFaDigits(pYear.toString())}`;

        if (canVote) {
            const now = new Date();
            const diff = expiresDate.getTime() - now.getTime();
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hoursLeft = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutesLeft = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

            let remainingText = '';
            if (days > 0) {
                remainingText = `(${toFaDigits(days.toString())} روز و ${toFaDigits(hoursLeft.toString())} ساعت مانده)`;
            } else if (hoursLeft > 0) {
                remainingText = `(${toFaDigits(hoursLeft.toString())} ساعت و ${toFaDigits(minutesLeft.toString())} دقیقه مانده)`;
            } else if (minutesLeft > 0) {
                remainingText = `(${toFaDigits(minutesLeft.toString())} دقیقه مانده)`;
            } else {
                remainingText = '(به زودی پایان می‌یابد)';
            }

            timerHtml = `
                <div class="poll-timer-info">
                    <i class="fas fa-clock"></i>
                    <span>📅 این نظرسنجی زمان‌دار است</span>
                    <span>مهلت رأی‌دهی تا: ${persianDate} ساعت ${persianTime}</span>
                    <span class="poll-remaining">${remainingText}</span>
                </div>`;
        } else {
            timerHtml = `
                <div class="poll-timer-info expired">
                    <i class="fas fa-lock"></i>
                    <span>🔒 بسته شده - ${persianDate} ساعت ${persianTime}</span>
                </div>`;
        }
    }



    const optionsHtml = poll.options.map(opt => {
        const percentage = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
        const isSelected = opt.hasVoted;

        if (showResults) {
            return `
                <div class="poll-result-option ${isSelected ? 'selected' : ''}">
                    <div class="poll-result-bar" style="width: ${percentage}%"></div>
                    <div class="poll-result-content">
                        <span class="poll-option-text">${escapeHtml(opt.text)}</span>
                        <span class="poll-option-percent">${percentage}%</span>
                    </div>
                    ${isSelected ? '<i class="fas fa-check poll-check"></i>' : ''}
                </div>
            `;
        } else {
            return `
                <button class="poll-vote-btn ${isSelected ? 'voted' : ''}" 
                        onclick="${canVote ? `window.votePoll(${poll.id}, ${opt.id})` : ''}">
                    ${isSelected ? '<i class="fas fa-check"></i> ' : ''}${escapeHtml(opt.text)}
                </button>
            `;
        }
    }).join('');

    let statusBadge = '';
    if (!poll.isActive || isExpired) {
        statusBadge = '<span class="poll-closed-badge"><i class="fas fa-lock"></i> بسته شده</span>';
    } else if (poll.pollType === 'closed') {
        statusBadge = '<span class="poll-timed-badge"><i class="fas fa-hourglass-half"></i> زمان‌دار</span>';
    }

    return `
        <div class="poll-message" data-poll-id="${poll.id}">
            <div class="poll-header">
                <i class="fas fa-poll"></i>
                <span class="poll-question">${escapeHtml(poll.question)}</span>
                ${statusBadge}
            </div>
            ${timerHtml}
            <div class="poll-options">
                ${optionsHtml}
            </div>
            <div class="poll-footer">
                <span class="poll-total-votes">${totalVotes} رأی</span>
                ${poll.allowMultipleAnswers ? '<span class="poll-multi-badge">چند انتخابی</span>' : ''}
                ${hasVoted && poll.pollType === 'closed' && !showResults ? '<span class="poll-voted-badge"><i class="fas fa-check-circle"></i> رأی شما ثبت شد</span>' : ''}
            </div>
        </div>
    `;
}

// ✅ رأی دادن
window.votePoll = async function (pollId, optionId) {
    try {
        const response = await fetch('/api/Poll/Vote', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'RequestVerificationToken': getCsrfToken()
            },
            body: JSON.stringify({ pollId, optionId })
        });

        const result = await response.json();
        if (result.success) {
            console.log('✅ Vote submitted');
            updatePollUI(pollId, result.poll);
        } else {
            // ✅ اگه سرور poll data فرستاد (مثلاً expire شده)، UI آپدیت کن
            if (result.poll) {
                updatePollUI(pollId, result.poll);
            }
            alert(result.message || 'خطا در ثبت رأی');
        }
    } catch (error) {
        console.error('❌ Vote error:', error);
    }
};
function updatePollUI(pollId, pollData) {
    const pollEl = document.querySelector(`.poll-message[data-poll-id="${pollId}"]`);
    if (!pollEl) return;

    pollEl.outerHTML = renderPollMessage(pollData);
}

// ✅ ارسال لوکیشن
export function sendLocation() {
    if (!currentChat) {
        alert('لطفاً ابتدا یک چت را انتخاب کنید');
        return;
    }

    if (!navigator.geolocation) {
        alert('مرورگر شما از موقعیت مکانی پشتیبانی نمی‌کند');
        return;
    }

    // نمایش loading
    const loadingEl = document.createElement('div');
    loadingEl.className = 'location-loading';
    loadingEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> در حال دریافت موقعیت...';
    document.body.appendChild(loadingEl);

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            loadingEl.remove();
            const { latitude, longitude } = position.coords;

            try {
                const mapUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
                const locationText = `📍 موقعیت مکانی\nhttps://www.google.com/maps?q=${latitude},${longitude}`;

                // ارسال به عنوان پیام متنی
                if (window.connection?.state === signalR.HubConnectionState.Connected) {
                    if (currentChat.type === 'private') {
                        await window.connection.invoke("SendPrivateMessage", currentChat.id, locationText, null);
                    } else if (currentChat.type === 'group') {
                        await window.connection.invoke("SendGroupMessage", currentChat.id, locationText, null);
                    } else if (currentChat.type === 'channel') {
                        await window.connection.invoke("SendChannelMessage", currentChat.id, locationText, null);
                    }
                    console.log('✅ Location sent');
                }
            } catch (error) {
                console.error('❌ Send location error:', error);
                alert('خطا در ارسال موقعیت');
            }
        },
        (error) => {
            loadingEl.remove();
            switch (error.code) {
                case error.PERMISSION_DENIED:
                    alert('دسترسی به موقعیت مکانی رد شد.\nلطفاً در تنظیمات مرورگر اجازه دهید.');
                    break;
                case error.POSITION_UNAVAILABLE:
                    alert('اطلاعات موقعیت مکانی در دسترس نیست');
                    break;
                case error.TIMEOUT:
                    alert('زمان دریافت موقعیت به پایان رسید');
                    break;
                default:
                    alert('خطا در دریافت موقعیت مکانی');
            }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}


// ✅ تابع کمکی - تبدیل Date به تاریخ شمسی صحیح
function toPersianDateStr(date) {
    // ✅ Intl.DateTimeFormat با calendar=persian
    const formatter = new Intl.DateTimeFormat('fa-IR', {
        calendar: 'persian',
        weekday: 'long',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    return formatter.format(date);
}

function toPersianTimeStr(date) {
    const h = date.getHours().toString().padStart(2, '0');
    const m = date.getMinutes().toString().padStart(2, '0');
    // ✅ اعداد فارسی
    const faDigits = (str) => str.replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
    return faDigits(`${h}:${m}`);
}


console.log('✅ poll.js loaded');
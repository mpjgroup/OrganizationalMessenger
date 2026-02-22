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
                channelId: currentChat.type === 'channel' ? currentChat.id : null
            })
        });

        const result = await response.json();
        if (result.success) {
            console.log('✅ Poll created:', result.pollId);
            closeDialog();

            // ✅ پیام‌ها رو دوباره لود کن تا نظرسنجی نمایش داده بشه
            import('./messages.js').then(module => {
                module.loadMessages(false);
            });

            // ✅ نوتیف SignalR هم بفرست
            if (window.connection?.state === signalR.HubConnectionState.Connected) {
                await window.connection.invoke("NotifyPollCreated", result.pollId, currentChat.id, currentChat.type);
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
    const totalVotes = poll.options.reduce((sum, opt) => sum + (opt.voteCount || 0), 0);
    const hasVoted = poll.options.some(opt => opt.hasVoted);
    const showResults = poll.pollType === 'open' || hasVoted || !poll.isActive;

    const optionsHtml = poll.options.map(opt => {
        const percentage = totalVotes > 0 ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
        const isSelected = opt.hasVoted;

        if (showResults) {
            return `
                <div class="poll-result-option ${isSelected ? 'selected' : ''}" 
                     data-poll-id="${poll.id}" data-option-id="${opt.id}"
                     onclick="${poll.isActive ? `window.votePoll(${poll.id}, ${opt.id})` : ''}">
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
                <button class="poll-vote-btn" onclick="window.votePoll(${poll.id}, ${opt.id})">
                    ${escapeHtml(opt.text)}
                </button>
            `;
        }
    }).join('');

    return `
        <div class="poll-message" data-poll-id="${poll.id}">
            <div class="poll-header">
                <i class="fas fa-poll"></i>
                <span class="poll-question">${escapeHtml(poll.question)}</span>
                ${!poll.isActive ? '<span class="poll-closed-badge">پایان یافته</span>' : ''}
            </div>
            <div class="poll-options">
                ${optionsHtml}
            </div>
            <div class="poll-footer">
                <span class="poll-total-votes">${totalVotes} رأی</span>
                ${poll.allowMultipleAnswers ? '<span class="poll-multi-badge">چند انتخابی</span>' : ''}
            </div>
        </div>
    `;
}

// ✅ رأی دادن
window.votePoll = async function(pollId, optionId) {
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
            // آپدیت UI نظرسنجی
            updatePollUI(pollId, result.poll);
        } else {
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

console.log('✅ poll.js loaded');
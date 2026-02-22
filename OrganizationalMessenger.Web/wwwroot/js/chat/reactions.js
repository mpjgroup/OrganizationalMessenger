// ============================================
// Message Reactions - Fixed
// ============================================

import { getCsrfToken } from './utils.js';

const popularEmojis = [
    '❤️', '👍', '👎', '😂', '😮', '😢', '😍', '🔥',
    '🌹', '👏', '🙏', '💯', '✅', '❌', '⭐', '💪',
    '🤝', '💡', '🚀', '🎯'
];

// ✅ جلوگیری از کلیک‌های همزمان
let isProcessing = false;

export function showReactionPicker(messageId) {
    console.log('😊 Showing reaction picker for message:', messageId);

    const existingPicker = document.getElementById('reactionPicker');
    if (existingPicker) {
        existingPicker.remove();
        return;
    }

    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) return;

    const addBtn = messageEl.querySelector('.reaction-add-btn');
    if (!addBtn) return;

    const isSent = messageEl.classList.contains('sent');

    const picker = document.createElement('div');
    picker.id = 'reactionPicker';
    picker.className = `reaction-picker ${isSent ? 'picker-sent' : 'picker-received'}`;
    picker.innerHTML = `
        <div class="reaction-picker-emojis">
            ${popularEmojis.map(emoji => `
                <button class="reaction-emoji-btn" data-emoji="${emoji}">
                    ${emoji}
                </button>
            `).join('')}
        </div>
    `;

    document.body.appendChild(picker);

    const rect = addBtn.getBoundingClientRect();
    let offsetX = isSent ? -20 : 20;

    picker.style.position = 'fixed';
    picker.style.left = (rect.left + (rect.width / 2) + offsetX) + 'px';
    picker.style.top = (rect.top - 8) + 'px';
    picker.style.transform = 'translateX(-50%) translateY(-100%)';

    const chatMainRect = document.querySelector('.chat-main')?.getBoundingClientRect();
    if (chatMainRect) {
        const pickerRect = picker.getBoundingClientRect();
        if (pickerRect.left < chatMainRect.left + 10) {
            picker.style.left = (chatMainRect.left + 20) + 'px';
            picker.style.transform = 'translateX(0%) translateY(-100%)';
        }
        if (pickerRect.right > chatMainRect.right - 10) {
            picker.style.left = (chatMainRect.right - pickerRect.width - 40) + 'px';
            picker.style.transform = 'translateX(0%) translateY(-100%)';
        }
    }

    picker.querySelectorAll('.reaction-emoji-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const emoji = btn.dataset.emoji;
            picker.remove();
            sendReaction(messageId, emoji);
        });
    });

    setTimeout(() => {
        const closePicker = (e) => {
            if (!picker.contains(e.target) && !addBtn.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        };
        document.addEventListener('click', closePicker);
    }, 100);
}

// ✅ یک تابع واحد برای ارسال reaction به سرور
async function sendReaction(messageId, emoji) {
    if (isProcessing) {
        console.log('⏳ Reaction already processing, skipping...');
        return;
    }
    isProcessing = true;

    console.log('🎭 Sending reaction:', messageId, emoji);

    try {
        const response = await fetch('/Chat/ReactToMessage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'RequestVerificationToken': getCsrfToken()
            },
            body: JSON.stringify({
                messageId: messageId,
                emoji: emoji
            })
        });

        const result = await response.json();
        console.log('📥 Reaction response:', result);

        if (result.success) {
            // ✅ آپدیت فوری UI با نتیجه واقعی سرور
            updateReactionsUI(messageId, result.reactions);

            // ✅ اطلاع‌رسانی به بقیه کاربران (Clients.Others)
            if (window.connection?.state === signalR.HubConnectionState.Connected) {
                try {
                    await window.connection.invoke(
                        "NotifyMessageReaction",
                        messageId,
                        emoji,
                        result.action,
                        result.reactions
                    );
                    console.log('✅ SignalR notified');
                } catch (signalrErr) {
                    console.warn('⚠️ SignalR notify failed:', signalrErr);
                }
            }
        } else {
            console.error('❌ Reaction failed:', result.message);
        }
    } catch (error) {
        console.error('❌ Reaction error:', error);
    } finally {
        isProcessing = false;
    }
}

// ✅ کلیک روی reaction موجود (toggle)
export async function toggleReaction(messageId, emoji) {
    console.log('🔄 Toggle reaction:', messageId, emoji);
    await sendReaction(messageId, emoji);
}

// ✅ از picker انتخاب شده
export async function addOrChangeReaction(messageId, emoji) {
    console.log('🎭 Add/change reaction:', messageId, emoji);
    await sendReaction(messageId, emoji);
}

// ✅ آپدیت UI ری‌اکشن‌ها
export function updateReactionsUI(messageId, reactions) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) return;

    let reactionsContainer = messageEl.querySelector('.message-reactions');
    if (!reactionsContainer) {
        const messageWrapper = messageEl.querySelector('.message-wrapper');
        if (messageWrapper) {
            reactionsContainer = document.createElement('div');
            reactionsContainer.className = 'message-reactions';
            messageWrapper.appendChild(reactionsContainer);
        }
    }

    if (reactionsContainer) {
        renderReactions(messageId, reactions, reactionsContainer);
    }
}

function renderReactions(messageId, reactions, container) {
    if (!reactions || reactions.length === 0) {
        container.innerHTML = `
            <button class="reaction-add-btn" onclick="window.showReactionPicker(${messageId})">
                <i class="far fa-smile"></i>
            </button>
        `;
        return;
    }

    const reactionsItems = reactions.map(r => `
        <div class="reaction-item ${r.hasReacted ? 'my-reaction' : ''}" 
             data-emoji="${r.emoji}"
             onclick="window.toggleReaction(${messageId}, '${r.emoji}')"
             title="${r.users ? r.users.map(u => u.name).join(', ') : ''}">
            <span class="reaction-emoji">${r.emoji}</span>
            <span class="reaction-count">${r.count}</span>
        </div>
    `).join('');

    container.innerHTML = `
        ${reactionsItems}
        <button class="reaction-add-btn" onclick="window.showReactionPicker(${messageId})" title="واکنش اضافه کن">
            <i class="far fa-smile"></i>
        </button>
    `;
}

// ✅ SignalR handler - فقط برای پیام‌هایی که از بقیه کاربران میاد
export function handleMessageReaction(data) {
    console.log('📥 SignalR MessageReaction:', data);
    if (data.reactions) {
        updateReactionsUI(data.messageId, data.reactions);
    }
}

// ✅ Global functions
window.showReactionPicker = showReactionPicker;
window.toggleReaction = toggleReaction;
window.addOrChangeReaction = addOrChangeReaction;

console.log('✅ reactions.js loaded');
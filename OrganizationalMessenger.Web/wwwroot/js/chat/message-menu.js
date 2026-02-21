// ============================================
// Message Menu - Edit, Delete, Toggle
// ============================================

import { connection } from './variables.js';
import { getCsrfToken, escapeHtml } from './utils.js';
import { replaceWithDeletedNotice } from './messages.js';
import { forwardMessage, enterMultiSelectMode } from './forward.js';

export function toggleMessageMenu(messageId) {
    const menu = document.getElementById(`menu-${messageId}`);
    if (!menu) {
        console.error(`❌ Menu not found for message ${messageId}`);
        return;
    }

    const messageEl = menu.closest('.message');
    const isSent = messageEl?.classList.contains('sent');

    document.querySelectorAll('.message-menu-dropdown').forEach(m => {
        if (m.id !== `menu-${messageId}`) {
            m.style.display = 'none';
            m.closest('.message')?.classList.remove('menu-open');
        }
    });

    if (menu.style.display === 'none' || !menu.style.display) {
        console.log(`✅ Opening menu for message ${messageId}`);
        menu.style.display = 'block';
        messageEl?.classList.add('menu-open');

        if (isSent) {
            menu.style.right = '0';
            menu.style.left = 'auto';
        } else {
            menu.style.left = '0px';
            menu.style.right = 'auto';
        }

        setTimeout(() => {
            const menuRect = menu.getBoundingClientRect();
            const messageRect = messageEl.getBoundingClientRect();
            const windowHeight = window.innerHeight;

            const distanceFromTop = messageRect.top;
            const distanceFromBottom = windowHeight - messageRect.bottom;
            const menuHeight = menuRect.height || 200;

            menu.classList.remove('open-upward', 'open-downward');

            if (distanceFromBottom > menuHeight + 50) {
                menu.style.top = '32px';
                menu.style.bottom = 'auto';
                menu.classList.add('open-downward');
            } else if (distanceFromTop > menuHeight + 50) {
                menu.style.bottom = '32px';
                menu.style.top = 'auto';
                menu.classList.add('open-upward');
            } else {
                menu.style.top = '32px';
                menu.style.bottom = 'auto';
                menu.classList.add('open-downward');
            }
        }, 10);
    } else {
        console.log(`✅ Closing menu for message ${messageId}`);
        menu.style.display = 'none';
        messageEl?.classList.remove('menu-open');
    }
}

// ✅ تعریف replyToMessage قبل از export
export function replyToMessage(messageId) {
    console.log('💬 Reply to message:', messageId);

    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) return;

    const textEl = messageEl.querySelector('[data-editable="true"]');
    const messageText = textEl ? textEl.textContent.trim() : 'پیام';

    const senderEl = messageEl.querySelector('.message-sender');
    const senderName = senderEl ? senderEl.textContent : 'کاربر';

    window.replyingTo = {
        messageId: messageId,
        messageText: messageText,
        senderName: senderName
    };

    const replyPreview = document.getElementById('replyPreview');
    if (replyPreview) {
        replyPreview.innerHTML = `
            <div class="reply-preview-content">
                <i class="fas fa-reply"></i>
                <div class="reply-info">
                    <strong>در حال پاسخ به ${escapeHtml(senderName)}</strong>
                    <p>${escapeHtml(messageText.substring(0, 50))}</p>
                </div>
                <button class="cancel-reply" onclick="window.cancelReply()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        replyPreview.style.display = 'flex';
    }

    document.getElementById('messageInput')?.focus();
    toggleMessageMenu(messageId);
}

export async function editMessage(messageId) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) return;

    // ✅ چک فوروارد بودن - فوروارد قابل ویرایش نیست
    if (messageEl.querySelector('.forwarded-badge')) {
        alert('پیام ارجاع‌شده قابل ویرایش نیست');
        return;
    }

    // ✅ پیدا کردن متن قابل ویرایش
    let textEl = messageEl.querySelector('[data-editable="true"]');
    let currentText = textEl ? textEl.textContent.trim() : '';

    // ✅ اگه متن خالیه (فایل بدون کپشن)، یه input خالی نشون بده
    const input = document.getElementById('messageInput');
    if (!input) return;

    input.value = currentText;
    input.focus();
    input.dataset.editingMessageId = messageId;

    // ✅ نشون بده داریم ویرایش میکنیم
    let editBanner = document.getElementById('editBanner');
    if (!editBanner) {
        editBanner = document.createElement('div');
        editBanner.id = 'editBanner';
        editBanner.className = 'edit-banner';
        editBanner.innerHTML = `
            <div class="edit-banner-content">
                <i class="fas fa-edit"></i>
                <span>در حال ویرایش${currentText ? ': ' + currentText.substring(0, 30) + '...' : ' (افزودن کپشن)'}</span>
                <button class="edit-cancel-btn" onclick="cancelEdit()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        const inputArea = document.getElementById('messageInputArea');
        inputArea?.parentNode.insertBefore(editBanner, inputArea);
    }

    // بستن منو
    const menu = document.getElementById(`menu-${messageId}`);
    if (menu) menu.style.display = 'none';
};

window.cancelEdit = function () {
    const input = document.getElementById('messageInput');
    if (input) {
        input.value = '';
        delete input.dataset.editingMessageId;
    }
    const banner = document.getElementById('editBanner');
    if (banner) banner.remove();
};


window.showViewStats = async function (messageId) {
    // بستن منو
    const menu = document.getElementById(`menu-${messageId}`);
    if (menu) menu.style.display = 'none';

    try {
        const response = await fetch(`/Chat/GetMessageViewStats?messageId=${messageId}`);
        const data = await response.json();

        if (!data.success) {
            alert('خطا در دریافت آمار');
            return;
        }

        // ساخت پاپ‌آپ
        const existingPopup = document.getElementById('viewStatsPopup');
        if (existingPopup) existingPopup.remove();

        const circumference = 2 * Math.PI * 40;
        const dashOffset = circumference - (data.percentage / 100) * circumference;

        const readersHtml = data.readers.map(r => {
            const readDate = new Date(r.readAt);
            const options = { weekday: 'long', day: 'numeric', month: 'long' };
            const persianDate = readDate.toLocaleDateString('fa-IR', options);
            const persianTime = readDate.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });

            return `
                <div class="view-stat-item">
                    <img src="${r.avatar}" class="view-stat-avatar" alt="${r.name}" />
                    <div class="view-stat-info">
                        <span class="view-stat-name">${r.name}</span>
                        <span class="view-stat-time">${persianDate} ${persianTime}</span>
                    </div>
                </div>
            `;
        }).join('');

        const popup = document.createElement('div');
        popup.id = 'viewStatsPopup';
        popup.className = 'view-stats-overlay';
        popup.innerHTML = `
            <div class="view-stats-popup">
                <div class="view-stats-header">
                    <h3><i class="fas fa-chart-bar"></i> آمار بازدید</h3>
                    <button class="view-stats-close" onclick="document.getElementById('viewStatsPopup')?.remove()">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <div class="view-stats-summary">
                    <div class="view-stats-circle">
                        <svg width="100" height="100">
                            <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" stroke-width="8"/>
                            <circle cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" stroke-width="8"
                                stroke-dasharray="${circumference}" 
                                stroke-dashoffset="${dashOffset}"
                                stroke-linecap="round"
                                transform="rotate(-90 50 50)"/>
                            <text x="50" y="50" text-anchor="middle" dominant-baseline="central" 
                                font-size="16" font-weight="bold" fill="#1f2937">
                                ${data.percentage}%
                            </text>
                        </svg>
                    </div>
                    <div class="view-stats-text">
                        <span class="view-stats-count">${data.viewCount} از ${data.totalMembers} نفر</span>
                        <span class="view-stats-label">مشاهده کرده‌اند</span>
                    </div>
                </div>

                <div class="view-stats-list">
                    ${readersHtml || '<p class="no-readers">هنوز کسی مشاهده نکرده</p>'}
                </div>
            </div>
        `;

        document.body.appendChild(popup);

        // کلیک روی overlay برای بستن
        popup.addEventListener('click', (e) => {
            if (e.target === popup) popup.remove();
        });

    } catch (error) {
        console.error('❌ View stats error:', error);
        alert('خطا در دریافت آمار بازدید');
    }
};

function showEditDialog(currentText, onSave) {
    const dialog = document.createElement('div');
    dialog.className = 'edit-dialog-overlay';
    dialog.innerHTML = `
        <div class="edit-dialog">
            <div class="edit-dialog-header">
                <h3>ویرایش پیام</h3>
                <button class="close-dialog" onclick="this.closest('.edit-dialog-overlay').remove(); document.body.style.overflow='auto'">✕</button>
            </div>
            <div class="edit-dialog-body">
                <textarea 
                    id="editMessageText" 
                    class="edit-input"
                    rows="5"
                    placeholder="متن پیام...">${escapeHtml(currentText)}</textarea>
            </div>
            <div class="edit-dialog-footer">
                <button class="btn-cancel" onclick="this.closest('.edit-dialog-overlay').remove(); document.body.style.overflow='auto'">
                    انصراف
                </button>
                <button class="btn-save" id="saveEditBtn">
                    <i class="fas fa-check"></i> ذخیره
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);
    document.body.style.overflow = 'hidden';

    const textarea = document.getElementById('editMessageText');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    document.getElementById('saveEditBtn').addEventListener('click', () => {
        const newText = textarea.value.trim();
        dialog.remove();
        document.body.style.overflow = 'auto';
        onSave(newText);
    });

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            document.getElementById('saveEditBtn').click();
        }
    });
}

export async function deleteMessage(messageId) {
    toggleMessageMenu(messageId);

    showConfirmDialog(
        'حذف پیام',
        'آیا از حذف این پیام اطمینان دارید؟',
        async () => {
            try {
                console.log('🗑️ Deleting message:', messageId);

                const response = await fetch('/Chat/DeleteMessage', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'RequestVerificationToken': getCsrfToken()
                    },
                    body: JSON.stringify({
                        messageId: messageId
                    })
                });

                const result = await response.json();
                console.log('📥 Delete response:', result);

                if (result.success) {
                    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);

                    if (result.showNotice) {
                        console.log('📝 ShowNotice=true, replacing with notice');
                        if (messageEl) {
                            replaceWithDeletedNotice(messageEl);
                        }
                    } else {
                        console.log('🗑️ ShowNotice=false, removing completely');
                        if (messageEl) {
                            messageEl.style.animation = 'fadeOut 0.3s ease';
                            setTimeout(() => {
                                messageEl.remove();
                            }, 300);
                        }
                    }

                    if (window.connection?.state === signalR.HubConnectionState.Connected) {
                        console.log('📡 Sending SignalR notification...');
                        await window.connection.invoke("NotifyMessageDeleted",
                            result.messageId,
                            result.showNotice,
                            result.receiverId
                        );
                        console.log('✅ SignalR notification sent');
                    }
                } else {
                    alert(result.message || 'خطا در حذف پیام');
                }
            } catch (error) {
                console.error('❌ Delete message error:', error);
                alert('خطا در حذف پیام');
            }
        }
    );
}

function showConfirmDialog(title, message, onConfirm) {
    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog-overlay';
    dialog.innerHTML = `
        <div class="confirm-dialog">
            <div class="confirm-dialog-header">
                <h3>${title}</h3>
            </div>
            <div class="confirm-dialog-body">
                <p>${message}</p>
            </div>
            <div class="confirm-dialog-footer">
                <button class="btn-cancel" onclick="this.closest('.confirm-dialog-overlay').remove(); document.body.style.overflow='auto'">
                    انصراف
                </button>
                <button class="btn-confirm" id="confirmBtn">
                    <i class="fas fa-check"></i> تأیید
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);
    document.body.style.overflow = 'hidden';

    document.getElementById('confirmBtn').addEventListener('click', () => {
        dialog.remove();
        document.body.style.overflow = 'auto';
        onConfirm();
    });
}

// ✅ Export to window - در انتها
window.toggleMessageMenu = toggleMessageMenu;
window.editMessage = editMessage;
window.deleteMessage = deleteMessage;
window.replyToMessage = replyToMessage;
window.forwardMessage = forwardMessage;
window.enterMultiSelectMode = enterMultiSelectMode;
window.reportMessage = function (messageId) {
    console.log('📢 Report message:', messageId);
    alert('این قابلیت به زودی اضافه می‌شود');
};

window.cancelReply = function () {
    window.replyingTo = null;
    const replyPreview = document.getElementById('replyPreview');
    if (replyPreview) {
        replyPreview.style.display = 'none';
    }
};

document.addEventListener('click', function (e) {
    if (!e.target.closest('.message-menu')) {
        document.querySelectorAll('.message-menu-dropdown').forEach(m => {
            m.style.display = 'none';
            m.closest('.message')?.classList.remove('menu-open');
        });
    }
});

console.log('✅ message-menu.js loaded');
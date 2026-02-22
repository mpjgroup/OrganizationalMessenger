// ============================================
// Message Handlers - Receive, Send, Status
// ============================================

import { currentChat, connection, isPageFocused } from './variables.js';
import { displayMessage, addUnreadSeparator, markMessagesAsRead, removeUnreadSeparator } from './messages.js';
import { loadChats, getActiveTab } from './chats.js';
import { formatPersianTime, scrollToBottom } from './utils.js';
import { hasMoreMessages, isLoadingMessages } from './variables.js';
import { loadMessages } from './messages.js';


export function handleReceiveMessage(data) {
    console.log('📨 ReceiveMessage:', data);

    // ✅ محافظت از پیام تکراری
    if (data.id && document.querySelector(`[data-message-id="${data.id}"]`)) {
        console.log('⚠️ Duplicate message ignored:', data.id);
        return;
    }

    let isCurrentChat = false;

    if (currentChat) {
        if (currentChat.type === 'private') {
            isCurrentChat = currentChat.id == data.senderId &&
                (!data.chatType || data.chatType === 'private') &&
                !data.groupId && !data.channelId;
        } else if (currentChat.type === 'group') {
            isCurrentChat = currentChat.id == data.chatId &&
                (data.chatType === 'group');
        } else if (currentChat.type === 'channel') {
            isCurrentChat = currentChat.id == data.chatId &&
                (data.chatType === 'channel');
        }
    }

    if (isCurrentChat) {
        if (!isPageFocused || document.hidden) {
            const existingSeparator = document.querySelector('.unread-separator');
            if (!existingSeparator) {
                const container = document.getElementById('messagesContainer');
                addUnreadSeparator(container, 1);
            }
        }

        displayMessage(data);
        scrollToBottom();

        if (isPageFocused && !document.hidden) {
            setTimeout(() => {
                markMessagesAsRead();
                removeUnreadSeparator();
            }, 100);
        } else {
            setTimeout(() => {
                if (connection?.state === signalR.HubConnectionState.Connected) {
                    connection.invoke("ConfirmDelivery", parseInt(data.id));
                }
            }, 100);
        }
    } else {
        updateUnreadBadge(data);
        loadChats(getActiveTab());

        // ✅ نوتیفیکیشن - چک muted بودن
        const chatId = data.chatId || data.senderId;
        const chatType = data.chatType || 'private';
        const chatData = (window.chats || []).find(c =>
            c.id == chatId && c.type === chatType
        );
        const isMuted = chatData?.isMuted || false;

        if (!isMuted) {
            // ✅ ساخت عنوان نوتیفیکیشن بر اساس نوع چت
            let notifTitle = data.senderName || 'پیام جدید';

            if (chatType === 'group' && chatData?.name) {
                notifTitle = `${data.senderName || 'کاربر'} - ${chatData.name}`;
            } else if (chatType === 'channel' && chatData?.name) {
                notifTitle = `📢 ${chatData.name}`;
            }

            const messageText = data.content || data.text || data.messageText || '';
            showBrowserNotification(notifTitle, messageText, data);
        }
    }
}


export function handleMessageSent(data) {
    console.log('✅ MessageSent received:', data);

    // ✅ محافظت از پیام تکراری
    if (data.id && document.querySelector(`[data-message-id="${data.id}"]`)) {
        console.log('⚠️ Duplicate sent message ignored:', data.id);
        loadChats(getActiveTab());
        return;
    }

    let isCurrentChat = false;

    if (currentChat) {
        if (currentChat.type === 'private') {
            isCurrentChat = currentChat.id == data.chatId &&
                (!data.chatType || data.chatType === 'private') &&
                !data.groupId && !data.channelId;
        } else if (currentChat.type === 'group') {
            isCurrentChat = currentChat.id == data.chatId &&
                (data.chatType === 'group');
        } else if (currentChat.type === 'channel') {
            isCurrentChat = currentChat.id == data.chatId &&
                (data.chatType === 'channel');
        }
    }

    if (!isCurrentChat) {
        console.log('⚠️ MessageSent is not for current chat, skipping display');
        loadChats(getActiveTab());
        return;
    }

    const tempMessages = document.querySelectorAll('.message[data-temp="true"]');
    tempMessages.forEach(msg => msg.remove());

    if (!data.sentAt) {
        data.sentAt = new Date().toISOString();
    }

    displayMessage(data);
    scrollToBottom();

    loadChats(getActiveTab());
}

export function updateMessageStatus(messageId, status, readAt = null) {
    console.log(`🔄 Updating message ${messageId} to ${status}`);

    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);

    if (!messageEl?.classList.contains('sent')) {
        console.log('⚠️ Message is not sent, skipping status update');
        return;
    }

    const sendInfoEl = messageEl.querySelector('.sent-info');
    if (!sendInfoEl) return;

    const sendTimeMatch = sendInfoEl.textContent.match(/ارسال:\s*(\d{1,2}:\d{2})/);
    const sendTime = sendTimeMatch ? sendTimeMatch[1] : formatPersianTime(new Date());

    const hasEditedBadge = sendInfoEl.querySelector('.edited-badge');
    const editedBadgeHtml = hasEditedBadge ? hasEditedBadge.outerHTML : '';

    let newStatusHtml = '';
    if (status === 'read' && readAt) {
        const readTime = formatPersianTime(readAt);
        newStatusHtml = `
            <div class="sent-info">
                ارسال: ${sendTime} &nbsp;&nbsp; مشاهده: ${readTime}
                <span class="tick double-blue">✓✓</span>
                ${editedBadgeHtml}
            </div>
        `;
    } else if (status === 'delivered') {
        newStatusHtml = `
            <div class="sent-info">
                ارسال: ${sendTime}
                <span class="tick double-gray">✓✓</span>
                ${editedBadgeHtml}
            </div>
        `;
    } else {
        newStatusHtml = `
            <div class="sent-info">
                ارسال: ${sendTime}
                <span class="tick single">✓</span>
                ${editedBadgeHtml}
            </div>
        `;
    }

    sendInfoEl.outerHTML = newStatusHtml;
    console.log(`✅ Message ${messageId} status updated to ${status}`);
}

export function setupScrollListener() {
    const container = document.getElementById('messagesContainer');
    if (!container) return;

    let isLoadingMore = false;

    container.addEventListener('scroll', async function () {
        if (isLoadingMore) return;

        if (container.scrollTop < 100 && hasMoreMessages && !isLoadingMessages) {
            console.log('🔄 Loading more messages...');
            isLoadingMore = true;

            try {
                await loadMessages(true);
            } finally {
                setTimeout(() => {
                    isLoadingMore = false;
                }, 500);
            }
        }
    });

    console.log('✅ Scroll listener attached');
}

// ============================================
// 🔔 نوتیفیکیشن بروزر
// ============================================

const NOTIF_PERMISSION_KEY = 'notif_permission_asked';

// ✅ نمایش پاپ‌آپ سفارشی قبل از درخواست مجوز بروزر
export function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('⚠️ Browser does not support notifications');
        return;
    }

    // اگر قبلاً مجوز داده شده
    if (Notification.permission === 'granted') {
        console.log('🔔 Notification already granted');
        return;
    }

    // اگر قبلاً رد کرده
    if (Notification.permission === 'denied') {
        console.log('🔕 Notification denied by user');
        return;
    }

    // ✅ اصلاح شد: اگر قبلاً "بعداً" زده ولی هنوز مجوز نداده، دوباره نشون بده
    // فقط اگر مجوز granted شده بود skip کن (بالا چک شده)
    // localStorage فقط جلوی نمایش بیش از حد در یک سشن رو میگیره
    if (sessionStorage.getItem('notif_asked_this_session') === 'true') {
        console.log('🔔 Already asked this session');
        return;
    }

    // ✅ با تأخیر 3 ثانیه نشون بده
    setTimeout(() => {
        showNotificationPermissionDialog();
    }, 3000);
}

function showNotificationPermissionDialog() {
    // حذف قبلی
    document.querySelector('.notif-permission-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'notif-permission-overlay';
    overlay.innerHTML = `
        <div class="notif-permission-dialog">
            <div class="notif-permission-icon">
                <div class="notif-bell-wrapper">
                    <i class="fas fa-bell notif-bell-icon"></i>
                    <span class="notif-bell-badge">!</span>
                </div>
            </div>
            <div class="notif-permission-body">
                <h3>دریافت اعلان پیام‌ها</h3>
                <p>
                    با فعال کردن اعلان‌ها، هر وقت پیام جدیدی دریافت کنید 
                    <strong>حتی اگر در صفحه دیگری باشید</strong>،
                    یک اعلان روی صفحه نمایش داده می‌شود.
                </p>
                <div class="notif-features">
                    <div class="notif-feature-item">
                        <i class="fas fa-comment-dots"></i>
                        <span>اعلان پیام‌های خصوصی</span>
                    </div>
                    <div class="notif-feature-item">
                        <i class="fas fa-users"></i>
                        <span>اعلان پیام‌های گروهی</span>
                    </div>
                    <div class="notif-feature-item">
                        <i class="fas fa-bullhorn"></i>
                        <span>اعلان پیام‌های کانال</span>
                    </div>
                    <div class="notif-feature-item">
                        <i class="fas fa-bell-slash"></i>
                        <span>امکان بی‌صدا کردن هر گروه/کانال</span>
                    </div>
                </div>
            </div>
            <div class="notif-permission-footer">
                <button class="notif-btn-accept" id="notifAcceptBtn">
                    <i class="fas fa-bell"></i>
                    فعال کردن اعلان‌ها
                </button>
                <button class="notif-btn-later" id="notifLaterBtn">
                    بعداً
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // ✅ دکمه قبول
    document.getElementById('notifAcceptBtn').addEventListener('click', () => {
        overlay.remove();
        sessionStorage.setItem('notif_asked_this_session', 'true');

        // ✅ درخواست واقعی مجوز بروزر
        Notification.requestPermission().then(permission => {
            console.log('🔔 Notification permission result:', permission);
            if (permission === 'granted') {
                try {
                    new Notification('پیام‌رسان سازمانی', {
                        body: '✅ اعلان‌ها با موفقیت فعال شدند!',
                        icon: '/images/default-avatar.png',
                        tag: 'test-notif'
                    });
                } catch (e) {
                    console.warn('Test notification failed:', e);
                }
            }
        }).catch(err => {
            console.error('Permission request error:', err);
        });
    });

    // ✅ دکمه بعداً
    document.getElementById('notifLaterBtn').addEventListener('click', () => {
        overlay.remove();
        sessionStorage.setItem('notif_asked_this_session', 'true');
    });

    // بستن با کلیک روی overlay
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
            sessionStorage.setItem('notif_asked_this_session', 'true');
        }
    });
}

// ✅ نمایش نوتیفیکیشن بروزر
function showBrowserNotification(title, body, data) {
    if (!('Notification' in window)) return;

    console.log('🔔 Trying to show notification:', { title, body, permission: Notification.permission });

    if (Notification.permission !== 'granted') {
        console.log('⚠️ Notification permission not granted');
        return;
    }

    createNotification(title, body, data);
}

function createNotification(title, body, data) {
    const notifTitle = title || 'پیام جدید';
    let notifBody = body || '';

    if (!notifBody) {
        if (data?.hasAttachments || data?.attachments?.length > 0) {
            const att = data.attachments?.[0];
            const ft = att?.fileType?.toString?.() || '';
            if (ft.includes('Image') || ft === '1') notifBody = '🖼️ تصویر';
            else if (ft.includes('Audio') || ft === '2') notifBody = '🎵 پیام صوتی';
            else if (ft.includes('Video') || ft === '3') notifBody = '🎬 ویدیو';
            else notifBody = '📎 فایل ضمیمه';
        } else {
            notifBody = 'پیام جدید';
        }
    }

    if (notifBody.length > 100) {
        notifBody = notifBody.substring(0, 97) + '...';
    }

    try {
        const notification = new Notification(notifTitle, {
            body: notifBody,
            icon: data?.senderAvatar || '/images/default-avatar.png',
            tag: `msg-${data?.id || Date.now()}`,
            renotify: true,
            requireInteraction: false
        });

        notification.onclick = () => {
            window.focus();
            notification.close();
        };

        setTimeout(() => {
            try { notification.close(); } catch (e) { }
        }, 6000);

        console.log('✅ Notification shown:', notifTitle);
    } catch (error) {
        console.error('❌ Notification error:', error);
    }
}


function updateUnreadBadge(data) {
    const chatId = data.chatId || data.senderId;
    const chatType = data.chatType || 'private';
    const chatItem = document.querySelector(`.chat-item[data-chat-id="${chatId}"][data-chat-type="${chatType}"]`);
    if (!chatItem) return;

    let badge = chatItem.querySelector('.unread-badge');
    if (badge) {
        const current = parseInt(badge.textContent) || 0;
        badge.textContent = current + 1 > 99 ? '99+' : current + 1;
    } else {
        const nameRow = chatItem.querySelector('.chat-name-row');
        if (nameRow) {
            badge = document.createElement('span');
            badge.className = 'unread-badge';
            badge.textContent = '1';
            nameRow.appendChild(badge);
        }
    }
}
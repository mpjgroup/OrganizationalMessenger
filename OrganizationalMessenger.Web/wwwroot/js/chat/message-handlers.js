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
            showBrowserNotification(data.senderName, data.content, data);
        }
    }
}


export function handleMessageSent(data) {
    console.log('✅ MessageSent received:', data);

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

// ✅ نوتیفیکیشن بروزر - کامل
function showBrowserNotification(title, body, data) {
    // چک مجوز
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
        createNotification(title, body, data);
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                createNotification(title, body, data);
            }
        });
    }
}

function createNotification(title, body, data) {
    const notifTitle = title || 'پیام جدید';
    let notifBody = body || '';

    // ��گر پیام فایل بود
    if (!notifBody && data?.type) {
        const typeMap = { 1: '🖼️ تصویر', 2: '🎵 صوتی', 3: '🎬 ویدیو', 4: '📎 فایل' };
        notifBody = typeMap[data.type] || 'پیام جدید';
    }

    const notification = new Notification(notifTitle, {
        body: notifBody,
        icon: data?.senderAvatar || '/images/default-avatar.png',
        badge: '/images/logo-badge.png',
        tag: `msg-${data?.id || Date.now()}`,
        renotify: true,
        silent: false
    });

    // کلیک روی نوتیفیکیشن → فوکوس روی پنجره
    notification.onclick = () => {
        window.focus();
        notification.close();
    };

    // بستن خودکار بعد از 5 ثانیه
    setTimeout(() => notification.close(), 5000);
}

// ✅ درخواست مجوز نوتیفیکیشن در شروع
export function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            console.log('🔔 Notification permission:', permission);
        });
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
// ============================================
// Messages - Load, Display, Settings
// ============================================

export { scrollToBottom } from './utils.js';
import {
    currentChat, isLoadingMessages, setIsLoadingMessages, hasMoreMessages, setHasMoreMessages,
    lastSenderId, setLastSenderId, messageGroupCount, setMessageGroupCount,
    messageSettings, setMessageSettings, isPageFocused
} from './variables.js';
import { escapeHtml, formatPersianTime, scrollToBottom, getInitials, getCsrfToken } from './utils.js';
import { renderFileAttachment } from './files.js';
import { connection } from './variables.js';

// ✅ فقط یک بار import کنید و re-export کنید

// ✅ Export کردن messageSettings برای دسترسی global
window.messageSettings = messageSettings;

function createReactionsHtml(reactions, messageId) {
    if (!reactions || reactions.length === 0) {
        return `
            <div class="message-reactions">
                <button class="reaction-add-btn" onclick="window.showReactionPicker(${messageId})">
                    <i class="far fa-smile"></i>
                </button>
            </div>
        `;
    }

    const reactionsItems = reactions.map(r => `
        <div class="reaction-item ${r.hasReacted ? 'my-reaction' : ''}" 
             data-emoji="${escapeHtml(r.emoji)}"
             onclick="window.toggleReaction(${messageId}, '${escapeHtml(r.emoji)}')"
             title="${r.users.map(u => u.name).join(', ')}">
            <span class="reaction-emoji">${r.emoji}</span>
            <span class="reaction-count">${r.count}</span>
        </div>
    `).join('');

    return `
        <div class="message-reactions">
            ${reactionsItems}
            <button class="reaction-add-btn" onclick="window.showReactionPicker(${messageId})">
                <i class="far fa-smile"></i>
            </button>
        </div>
    `;
}


export async function loadMessageSettings() {
    try {
        const response = await fetch('/Chat/GetMessageSettings');

        if (!response.ok) {
            console.warn('⚠️ Settings API not available, using defaults');
            setMessageSettings({
                allowEdit: true,
                allowDelete: true,
                editTimeLimit: 3600,
                deleteTimeLimit: 7200
            });
            return;
        }

        const result = await response.json();

        if (result && result.success) {
            setMessageSettings({
                allowEdit: result.allowEdit || false,
                allowDelete: result.allowDelete || false,
                editTimeLimit: result.editTimeLimit || 3600,
                deleteTimeLimit: result.deleteTimeLimit || 7200
            });
            console.log('✅ Message settings loaded:', messageSettings);
        }
    } catch (error) {
        console.warn('⚠️ Load settings error:', error.message);
        setMessageSettings({
            allowEdit: true,
            allowDelete: true,
            editTimeLimit: 3600,
            deleteTimeLimit: 7200
        });



        // ✅ لود تنظیمات فوروارد
        try {
            const fwdResponse = await fetch('/Chat/GetForwardSettings');
            if (fwdResponse.ok) {
                const fwdResult = await fwdResponse.json();
                window.displayOriginalNameInForward = fwdResult.displayOriginalName ?? true;
                console.log('✅ Forward settings loaded:', window.displayOriginalNameInForward);
            }
        } catch (e) {
            window.displayOriginalNameInForward = true;
        }


    }
}

// ✅ توابع کمکی - قبل از loadMessages تعریف شوند
function getMessageDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fa-IR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function isSameDay(date1, date2) {
    return date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate();
}

export function addDateSeparator(container, dateStr) {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let label = '';
    const persianDate = date.toLocaleDateString('fa-IR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });

    if (isSameDay(date, today)) {
        label = `امروز ${persianDate}`;
    } else if (isSameDay(date, yesterday)) {
        label = `دیروز ${persianDate}`;
    } else {
        label = persianDate;
    }

    const separator = document.createElement('div');
    separator.className = 'date-separator';
    separator.innerHTML = `
        <div class="date-line"></div>
        <span class="date-label">${label}</span>
        <div class="date-line"></div>
    `;

    container.appendChild(separator);
}

export function addUnreadSeparator(container, count) {
    const separator = document.createElement('div');
    separator.className = 'unread-separator';
    separator.innerHTML = `
        <div class="unread-line"></div>
        <span class="unread-label">${count} پیام جدید</span>
        <div class="unread-line"></div>
    `;
    container.appendChild(separator);
}

export function removeUnreadSeparator() {
    const separator = document.querySelector('.unread-separator');
    if (!separator) {
        console.log('⚠️ No separator to remove');
        return;
    }

    console.log('🗑️ Removing separator');
    separator.remove();
}

// ✅ حالا loadMessages می‌تواند از getMessageDate استفاده کند
export async function loadMessages(append = false) {
    if (!currentChat) return;
    if (isLoadingMessages) return;

    setIsLoadingMessages(true);

    try {
        let url = `/Chat/GetMessages?pageSize=20`;

        if (currentChat.type === 'private') {
            url += `&userId=${currentChat.id}`;
        } else if (currentChat.type === 'group') {
            url += `&groupId=${currentChat.id}`;
        } else if (currentChat.type === 'channel') {
            url += `&channelId=${currentChat.id}`;
        }

        if (append) {
            const firstMessage = document.querySelector('#messagesContainer .message[data-message-id]');
            if (firstMessage) {
                const oldestId = firstMessage.dataset.messageId;
                url += `&beforeMessageId=${oldestId}`;
                console.log(`📜 Loading more before message: ${oldestId}`);
            }
        }

        const response = await fetch(url);
        const data = await response.json();

        const container = document.getElementById('messagesContainer');

        if (!append) {
            container.innerHTML = '';
            setLastSenderId(null);
            setMessageGroupCount(0);
        }

        const previousScrollHeight = container.scrollHeight;
        const previousScrollTop = container.scrollTop;

        if (append && data.messages.length > 0) {
            console.log(`📜 Appending ${data.messages.length} older messages`);

            const existingHTML = container.innerHTML;
            container.innerHTML = '';

            setLastSenderId(null);
            setMessageGroupCount(0);

            let lastDate = null;
            data.messages.forEach(msg => {
                const messageDate = getMessageDate(msg.sentAt);
                if (messageDate !== lastDate) {
                    addDateSeparator(container, msg.sentAt);
                    lastDate = messageDate;
                }
                displayMessage(msg);
            });

            container.innerHTML += existingHTML;

            const newScrollHeight = container.scrollHeight;
            container.scrollTop = newScrollHeight - previousScrollHeight + previousScrollTop;

            console.log(`✅ Scroll adjusted from ${previousScrollHeight} to ${newScrollHeight}`);
        } else {
            const unreadMessages = data.messages.filter(msg =>
                msg.senderId !== window.currentUserId && !msg.isRead && !msg.isDeleted
            );

            const shouldShowUnreadSeparator = unreadMessages.length > 0;
            let unreadSeparatorAdded = false;
            let lastDate = null;

            console.log(`📊 Total messages: ${data.messages.length}, Unread: ${unreadMessages.length}`);

            data.messages.forEach((msg) => {
                const messageDate = getMessageDate(msg.sentAt);

                if (messageDate !== lastDate) {
                    console.log(`📅 Adding date separator: ${messageDate}`);
                    addDateSeparator(container, msg.sentAt);
                    lastDate = messageDate;
                }

                if (!unreadSeparatorAdded && shouldShowUnreadSeparator &&
                    unreadMessages.length > 0 && msg.id === unreadMessages[0].id) {
                    console.log(`🔔 Adding unread separator before message ${msg.id}, count: ${unreadMessages.length}`);
                    addUnreadSeparator(container, unreadMessages.length);
                    unreadSeparatorAdded = true;
                }

                displayMessage(msg);
            });
        }

        setHasMoreMessages(data.hasMore);

        console.log(`✅ Loaded ${data.messages.length} messages, hasMore: ${data.hasMore}`);
    } catch (error) {
        console.error('❌ Load messages error:', error);
    } finally {
        setIsLoadingMessages(false);
    }
}

export function displayMessage(msg) {
    console.log(`📩 Displaying message:`, {
        id: msg.id,
        text: (msg.content || msg.messageText || '').substring(0, 30),
        sentAt: msg.sentAt,
        hasAttachments: !!(msg.attachments && msg.attachments.length > 0),
        reactions: msg.reactions || []
    });

    const isSent = msg.senderId === window.currentUserId;
    const container = document.getElementById('messagesContainer');

    const hasAttachments = msg.attachments && msg.attachments.length > 0;
    const isConsecutive = !hasAttachments &&
        lastSenderId === msg.senderId &&
        messageGroupCount < 10;

    if (isConsecutive) {
        setMessageGroupCount(messageGroupCount + 1);
    } else {
        setLastSenderId(msg.senderId);
        setMessageGroupCount(1);
    }

    const messageEl = document.createElement('div');
    messageEl.className = `message ${isSent ? 'sent' : 'received'} ${isConsecutive ? 'consecutive' : ''}`;
    messageEl.dataset.messageId = msg.id;

    const sentAt = msg.sentAt || new Date().toISOString();
    messageEl.dataset.sentAt = sentAt;

    if (msg.isDeleted) {
        messageEl.classList.add('deleted');
        messageEl.innerHTML = `
            <div class="message-wrapper">
                <div class="message-bubble">
                    <div class="message-content deleted-message">
                        <div class="deleted-text">
                            ${isSent ? 'شما این پیام را حذف کردید' : 'این پیام حذف شده است'}
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(messageEl);
        return;
    }

    const sendTime = formatPersianTime(msg.sentAt || new Date());

    let avatarSectionHtml = '';
    if (!isConsecutive) {
        const avatarContent = msg.senderAvatar ?
            `<img src="${msg.senderAvatar}" alt="${escapeHtml(msg.senderName)}" class="message-avatar-img" />` :
            getInitials(msg.senderName);

        avatarSectionHtml = `
            <div class="message-avatar-section">
                <div class="message-avatar">${avatarContent}</div>
                <div class="message-sender">${escapeHtml(msg.senderName)}</div>
            </div>
        `;
    }

    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
        const isSent = msg.senderId === window.currentUserId;
        attachmentsHtml = msg.attachments
            .map(file => renderFileAttachment(file, isSent))
            .join('');
    }

    let messageTextHtml = '';
    const messageContent = msg.content || msg.messageText || '';

    if (hasAttachments) {
        if (messageContent && !messageContent.startsWith('📎') && !messageContent.startsWith('🎤')) {
            messageTextHtml = `<div class="message-caption" data-editable="true">${escapeHtml(messageContent)}</div>`;
        }
    } else {
        if (messageContent) {
            messageTextHtml = `<div class="message-text" data-editable="true">${escapeHtml(messageContent)}</div>`;
        }
    }

    const editedBadge = msg.isEdited ? '<span class="edited-badge">ویرایش شده</span>' : '';

    let statusHtml = '';
    if (isSent) {
        const readTime = msg.readAt ? formatPersianTime(msg.readAt) : null;
        if (msg.isRead && readTime) {
            statusHtml = `
                <div class="sent-info">
                    ارسال: ${sendTime} &nbsp;&nbsp; مشاهده: ${readTime}
                    <span class="tick double-blue">✓✓</span>
                    ${editedBadge}
                </div>`;
        } else if (msg.isDelivered) {
            statusHtml = `
                <div class="sent-info">
                    ارسال: ${sendTime}
                    <span class="tick double-gray">✓✓</span>
                    ${editedBadge}
                </div>`;
        } else {
            statusHtml = `
                <div class="sent-info">
                    ارسال: ${sendTime}
                    <span class="tick single">✓</span>
                    ${editedBadge}
                </div>`;
        }
    } else {
        statusHtml = `<div class="message-time">${sendTime} ${editedBadge}</div>`;
    }

    // ✅ بخش Reply
    let replyHtml = '';
    if (msg.replyToMessageId && msg.replyToText) {
        replyHtml = `
            <div class="reply-preview" onclick="scrollToMessage(${msg.replyToMessageId})">
                <div class="reply-bar"></div>
                <div class="reply-content">
                    <span class="reply-sender">${escapeHtml(msg.replyToSenderName || 'کاربر')}</span>
                    <span class="reply-text">${escapeHtml(msg.replyToText.substring(0, 50))}${msg.replyToText.length > 50 ? '...' : ''}</span>
                </div>
            </div>
        `;
    }

    // ✅ علامت فوروارد
    // ✅ علامت فوروارد - با تنظیم
    let forwardHtml = '';
    if (msg.forwardedFromMessageId || msg.forwardedFromUserId) {
        const showName = window.displayOriginalNameInForward !== false;
        if (showName && msg.forwardedFromUserName) {
            forwardHtml = `
                <div class="forwarded-badge">
                    <i class="fas fa-share"></i>
                    <span>ارجاع شده از: ${escapeHtml(msg.forwardedFromUserName)}</span>
                </div>
            `;
        } else {
            forwardHtml = `
                <div class="forwarded-badge">
                    <i class="fas fa-share"></i>
                    <span>ارجاع شده</span>
                </div>
            `;
        }
    }

    const reactionsHtml = createReactionsHtml(msg.reactions || [], msg.id);

    const isForwarded = !!(msg.forwardedFromMessageId || msg.forwardedFromUserId);
    const messageMenuHtml = createMessageMenu(msg.id, isSent, sentAt, isForwarded);




    messageEl.innerHTML = `
        <div class="message-wrapper">
            ${!isConsecutive ? avatarSectionHtml : ''}
            <div class="message-bubble">
                <div class="message-content">
                    ${forwardHtml}
                    ${replyHtml}
                    ${attachmentsHtml}
                    ${messageTextHtml}
                    ${statusHtml}
                </div>
                ${messageMenuHtml}
            </div>
            ${reactionsHtml}
        </div>
    `;

    container.appendChild(messageEl);
}



function createMessageMenu(messageId, isSent, sentAt, isForwarded = false) {
    if (isSent) {
        const canEdit = !isForwarded && canEditMessage(sentAt);
        const canDelete = canDeleteMessage(sentAt);

        return `
            <div class="message-menu">
                <button class="message-menu-btn" onclick="toggleMessageMenu(${messageId})">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <div class="message-menu-dropdown" id="menu-${messageId}" style="display: none;">
                    <button onclick="replyToMessage(${messageId})">
                        <i class="fas fa-reply"></i> پاسخ
                    </button>
                    <button onclick="forwardMessage(${messageId})">
                        <i class="fas fa-share"></i> ارجاع
                    </button>
                    <button onclick="enterMultiSelectMode()">
                        <i class="fas fa-check-square"></i> ارجاع چندین پیام
                    </button>
                    <button onclick="showViewStats(${messageId})">
                        <i class="fas fa-chart-bar"></i> آمار بازدید
                    </button>
                    ${canEdit ? `
                    <button onclick="editMessage(${messageId})">
                        <i class="fas fa-edit"></i> ویرایش
                    </button>` : ''}
                    ${canDelete ? `
                    <button onclick="deleteMessage(${messageId})" class="delete-btn">
                        <i class="fas fa-trash"></i> حذف
                    </button>` : ''}
                </div>
            </div>
        `;
    } else {
        return `
            <div class="message-menu">
                <button class="message-menu-btn" onclick="toggleMessageMenu(${messageId})">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <div class="message-menu-dropdown" id="menu-${messageId}" style="display: none;">
                    <button onclick="replyToMessage(${messageId})">
                        <i class="fas fa-reply"></i> پاسخ
                    </button>
                    <button onclick="forwardMessage(${messageId})">
                        <i class="fas fa-share"></i> ارجاع
                    </button>
                    <button onclick="enterMultiSelectMode()">
                        <i class="fas fa-check-square"></i> ارجاع چندین پیام
                    </button>
                    <button onclick="showViewStats(${messageId})">
                        <i class="fas fa-chart-bar"></i> آمار بازدید
                    </button>
                    <button onclick="reportMessage(${messageId})" class="report-btn">
                        <i class="fas fa-flag"></i> گزارش
                    </button>
                </div>
            </div>
        `;
    }
}


function canEditMessage(sentAt) {
    if (!messageSettings.allowEdit) return false;
    const sentDate = new Date(sentAt);
    const now = new Date();
    const elapsed = (now - sentDate) / 1000;
    return elapsed <= messageSettings.editTimeLimit;
}

function canDeleteMessage(sentAt) {
    if (!messageSettings.allowDelete) return false;
    const sentDate = new Date(sentAt);
    const now = new Date();
    const elapsed = (now - sentDate) / 1000;
    return elapsed <= messageSettings.deleteTimeLimit;
}

export async function markMessagesAsRead() {
    if (!currentChat?.id) {
        console.log('⚠️ Cannot mark as read: no current chat');
        return;
    }

    // ✅ همه پیام‌های دریافتی (received) در DOM
    const unreadReceivedMessages = Array.from(
        document.querySelectorAll('#messagesContainer .message.received[data-message-id]')
    );

    const unreadReceivedIds = unreadReceivedMessages
        .map(el => parseInt(el.dataset.messageId))
        .filter(id => !isNaN(id));

    console.log(`📖 Unread message IDs to mark: ${unreadReceivedIds.join(', ')}`);

    if (unreadReceivedIds.length === 0) {
        console.log('✅ No messages to mark');
        removeUnreadBadge();
        return;
    }

    try {
        const response = await fetch('/Chat/MarkMessagesAsRead', {
            method: 'POST',
            headers: {
                'RequestVerificationToken': getCsrfToken(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ messageIds: unreadReceivedIds })
        });

        if (!response.ok) {
            console.error('❌ MarkMessagesAsRead failed:', response.status);
            return;
        }

        const result = await response.json();
        console.log(`✅ Server marked ${result.markedCount} messages as read`);

        // ✅ فقط برای private از SignalR notify کن (تیک آبی)
        if (currentChat.type === 'private' && window.connection?.state === signalR.HubConnectionState.Connected) {
            await window.connection.invoke("NotifyMessagesRead", unreadReceivedIds);
        }

        removeUnreadBadge();
    } catch (error) {
        console.error('❌ Mark as read error:', error);
    }
}
function removeUnreadBadge() {
    if (!currentChat) return;

    const chatItem = document.querySelector(`.chat-item[data-chat-id="${currentChat.id}"]`);
    if (!chatItem) return;

    const badge = chatItem.querySelector('.unread-badge');
    if (badge && badge.parentNode) {
        console.log('🗑️ Removing unread badge');
        badge.parentNode.removeChild(badge);
        console.log('✅ Unread badge removed');
    }
}

export function replaceWithDeletedNotice(messageEl) {
    const isSent = messageEl.classList.contains('sent');
    const messageBubble = messageEl.querySelector('.message-bubble');
    if (!messageBubble) return;

    messageBubble.innerHTML = `
        <div class="message-content deleted-message">
            <div class="deleted-text">
                ${isSent ? 'شما این پیام را حذف کردید' : 'این پیام حذف شده است'}
            </div>
        </div>
    `;

    messageEl.classList.add('deleted');
}

export function scrollToMessage(messageId) {
    const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageEl) {
        alert('پیام مورد نظر یافت نشد');
        return;
    }

    messageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    messageEl.classList.add('highlight');
    setTimeout(() => {
        messageEl.classList.remove('highlight');
    }, 2000);
}

window.scrollToMessage = scrollToMessage;
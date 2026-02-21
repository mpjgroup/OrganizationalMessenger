// ============================================
// Voice Recording & Player v2.0
// ============================================

import {
    mediaRecorder, setMediaRecorder,
    audioChunks, setAudioChunks,
    isRecording, setIsRecording,
    recordingStartTime, setRecordingStartTime,
    recordingTimer, setRecordingTimer,
    currentPlayingAudio, setCurrentPlayingAudio,
    currentChat
} from './variables.js';
import { getCsrfToken, formatDuration, scrollToBottom } from './utils.js';

export function setupVoiceRecording() {
    const micBtn = document.getElementById('micBtn');
    if (!micBtn) return;

    micBtn.addEventListener('mousedown', startRecording);
    micBtn.addEventListener('touchstart', startRecording);
    micBtn.addEventListener('mouseup', stopRecording);
    micBtn.addEventListener('touchend', stopRecording);
    micBtn.addEventListener('mouseleave', cancelRecording);
}

async function startRecording(e) {
    e.preventDefault();

    if (!currentChat) {
        alert('لطفاً ابتدا یک چت را انتخاب کنید');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        setMediaRecorder(new MediaRecorder(stream, {
            mimeType: 'audio/webm;codecs=opus'
        }));

        setAudioChunks([]);

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await processVoiceMessage(audioBlob);
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        setIsRecording(true);
        setRecordingStartTime(Date.now());

        const micBtn = document.getElementById('micBtn');
        micBtn.classList.add('recording');
        micBtn.innerHTML = '<i class="fas fa-stop"></i>';

        showRecordingTimer();
        console.log('🎤 Recording started');

    } catch (error) {
        console.error('❌ Microphone error:', error);
        alert('دسترسی به میکروفون رد شد');
    }
}

function stopRecording(e) {
    e.preventDefault();
    if (!isRecording || !mediaRecorder) return;

    setIsRecording(false);
    mediaRecorder.stop();

    const micBtn = document.getElementById('micBtn');
    micBtn.classList.remove('recording');
    micBtn.innerHTML = '<i class="fas fa-microphone"></i>';

    hideRecordingTimer();
    console.log('🎤 Recording stopped');
}

function cancelRecording(e) {
    if (!isRecording || !mediaRecorder) return;

    setIsRecording(false);
    mediaRecorder.stop();
    setAudioChunks([]);

    const micBtn = document.getElementById('micBtn');
    micBtn.classList.remove('recording');
    micBtn.innerHTML = '<i class="fas fa-microphone"></i>';

    hideRecordingTimer();
    console.log('🎤 Recording cancelled');
}

function showRecordingTimer() {
    const inputWrapper = document.querySelector('.input-wrapper');
    const timer = document.createElement('div');
    timer.id = 'recordingTimer';
    timer.className = 'recording-timer';
    timer.innerHTML = `
        <div class="recording-indicator">
            <div class="recording-pulse"></div>
            <span class="recording-time">00:00</span>
        </div>
        <span class="recording-hint">← رها کنید برای ارسال</span>
    `;

    inputWrapper.parentNode.insertBefore(timer, inputWrapper);

    setRecordingTimer(setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');

        const timeEl = document.querySelector('.recording-time');
        if (timeEl) timeEl.textContent = `${minutes}:${seconds}`;

        if (elapsed >= 300) stopRecording(new Event('mouseup'));
    }, 1000));
}

function hideRecordingTimer() {
    const timer = document.getElementById('recordingTimer');
    if (timer) timer.remove();

    if (recordingTimer) {
        clearInterval(recordingTimer);
        setRecordingTimer(null);
    }
}

async function processVoiceMessage(audioBlob) {
    if (!currentChat) return;

    const duration = Math.floor((Date.now() - recordingStartTime) / 1000);

    if (duration < 1) {
        console.log('⚠️ Audio too short');
        return;
    }

    try {
        showUploadProgress('پیام صوتی');

        const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, {
            type: 'audio/webm'
        });

        const formData = new FormData();
        formData.append('file', audioFile);
        formData.append('duration', duration);
        formData.append('caption', '🎤 پیام صوتی');

        const response = await fetch('/api/File/upload', {
            method: 'POST',
            headers: { 'RequestVerificationToken': getCsrfToken() },
            body: formData
        });

        if (!response.ok) throw new Error('Upload failed');

        const result = await response.json();

        if (result.success) {
            // ✅ مستقیماً SignalR رو صدا بزن - فقط یک بار آپلود!
            await sendVoiceMessageViaSignalR(result.file, duration);
            hideUploadProgress();
        } else {
            alert(result.message || 'خطا در آپلود');
            hideUploadProgress();
        }
    } catch (error) {
        console.error('❌ Voice error:', error);
        alert('خطا در ارسال پیام صوتی');
        hideUploadProgress();
    }
}



// ✅ تابع جدید - فقط SignalR
async function sendVoiceMessageViaSignalR(file, duration) {
    if (!currentChat || !window.connection) {
        console.error('❌ currentChat یا connection موجود نیست');
        return;
    }

    if (window.connection.state !== signalR.HubConnectionState.Connected) {
        console.error('❌ SignalR is not connected!');
        alert('اتصال برقرار نیست');
        return;
    }

    const messageText = '🎤 پیام صوتی';

    try {
        console.log('📤 Sending voice message via SignalR...');

        if (currentChat.type === 'private') {
            // ✅ فقط SignalR
            await window.connection.invoke(
                "SendPrivateMessageWithFile",
                currentChat.id,
                messageText,
                file.id,
                duration
            );
        } else if (currentChat.type === 'group') {
            await window.connection.invoke(
                "SendGroupMessageWithFile",
                currentChat.id,
                messageText,
                file.id,
                duration
            );
        } else if (currentChat.type === 'channel') {
            await window.connection.invoke(
                "SendChannelMessageWithFile",
                currentChat.id,
                messageText,
                file.id,
                duration
            );
        }

        console.log('✅ Voice message sent via SignalR');
        scrollToBottom();
    } catch (error) {
        console.error('❌ Send voice message error:', error);
        alert('خطا در ارسال پیام صوتی');
    }
}
// ✅ تابع کمکی
async function sendFileMessage(file, caption) {
    if (!currentChat || !window.connection) return;

    const messageText = caption || `📎 ${file.originalFileName}`;

    try {
        const response = await fetch('/Chat/SendMessage', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'RequestVerificationToken': getCsrfToken()
            },
            body: JSON.stringify({
                receiverId: currentChat.type === 'private' ? currentChat.id : null,
                groupId: currentChat.type === 'group' ? currentChat.id : null,
                messageText: messageText,
                type: 3, // Audio
                fileAttachmentId: file.id
            })
        });

        const result = await response.json();
        if (result.success) {
            if (window.connection?.state === signalR.HubConnectionState.Connected) {
                if (currentChat.type === 'private') {
                    await window.connection.invoke(
                        "SendPrivateMessageWithFile",
                        currentChat.id,
                        messageText,
                        result.messageId,
                        file.id
                    );
                }
            }
        }
    } catch (error) {
        console.error('❌ Send file message error:', error);
    }
}








function showUploadProgress(fileName) {
    const container = document.getElementById('messagesContainer');
    const progressEl = document.createElement('div');
    progressEl.id = 'uploadProgress';
    progressEl.className = 'upload-progress';
    progressEl.innerHTML = `
        <div class="upload-progress-content">
            <div class="spinner"></div>
            <span>در حال آپلود: ${fileName}</span>
        </div>
    `;
    container.appendChild(progressEl);
    scrollToBottom();
}

function hideUploadProgress() {
    document.getElementById('uploadProgress')?.remove();
}

export function renderAudioPlayer(file) {
    const audioId = `audio_${file.id}`;
    const duration = file.duration || 0;
    const durationText = formatDuration(duration);

    // ✅ بررسی وجود URL
    if (!file.fileUrl) {
        console.error('❌ File URL is missing:', file);
        return `<div class="message-file audio-file voice-message">❌ فایل یافت نشد</div>`;
    }

    // ✅ تشخیص فرمت
    const ext = file.extension?.toLowerCase() || '.webm';
    let mimeType = 'audio/webm';

    if (['.mp3'].includes(ext)) mimeType = 'audio/mpeg';
    else if (['.ogg'].includes(ext)) mimeType = 'audio/ogg';
    else if (['.m4a'].includes(ext)) mimeType = 'audio/mp4';
    else if (['.wav'].includes(ext)) mimeType = 'audio/wav';

    return `
        <div class="message-file audio-file voice-message" data-audio-id="${file.id}">
            <button class="voice-play-btn" onclick="window.toggleVoicePlay(${file.id})">
                <i class="fas fa-play"></i>
            </button>
            <div class="voice-content">
                <div class="voice-progress-container" onclick="window.seekVoice(event, ${file.id})">
                    <div class="voice-progress-bar">
                        <div class="voice-progress-fill" id="progress_${file.id}"></div>
                    </div>
                </div>
                <div class="voice-meta">
                    <span class="voice-duration" id="duration_${file.id}">${durationText}</span>
                    <button class="voice-speed" onclick="window.changeVoiceSpeed(${file.id}); event.stopPropagation();">
                        <span id="speed_${file.id}">1.0x</span>
                    </button>
                </div>
            </div>
            <audio id="${audioId}" preload="metadata">
                <source src="${file.fileUrl}" type="${mimeType}">
                مرورگر شما از پخش فایل صوتی پشتیبانی نمی‌کند.
            </audio>
        </div>
    `;
}

export function toggleVoicePlay(fileId) {
    const audio = document.getElementById(`audio_${fileId}`);
    const container = document.querySelector(`.message-file[data-audio-id="${fileId}"]`);
    const btn = container?.querySelector('.voice-play-btn');

    if (!audio || !btn) {
        console.error('❌ Audio element not found:', fileId);
        return;
    }

    // ✅ بررسی منبع ف��یل
    const source = audio.querySelector('source');
    if (!source || !source.src) {
        console.error('❌ Audio source is missing:', fileId);
        alert('فایل صوتی یافت نشد');
        return;
    }

    console.log('🎵 Audio source:', source.src);
    console.log('🎵 Audio ready state:', audio.readyState);
    console.log('🎵 Audio network state:', audio.networkState);

    if (currentPlayingAudio && currentPlayingAudio !== audio) {
        stopVoicePlay(currentPlayingAudio);
    }

    if (audio.paused) {
        audio.play()
            .then(() => {
                console.log('✅ Audio playing');
                btn.innerHTML = '<i class="fas fa-pause"></i>';
                btn.classList.add('playing');
                setCurrentPlayingAudio(audio);

                audio.ontimeupdate = () => {
                    updateVoiceDuration(fileId, audio);
                    updateProgressBar(fileId, audio);
                };

                audio.onended = () => {
                    stopVoicePlay(audio);
                    resetVoiceUI(fileId);
                };
            })
            .catch(error => {
                console.error('❌ Play error:', error);
                alert(`خطا در پخش: ${error.message}`);
            });
    } else {
        stopVoicePlay(audio);
    }
}

function stopVoicePlay(audio) {
    if (!audio) return;
    audio.pause();

    const audioId = audio.id.replace('audio_', '');
    const container = document.querySelector(`.message-file[data-audio-id="${audioId}"]`);
    const btn = container?.querySelector('.voice-play-btn');

    if (btn) {
        btn.innerHTML = '<i class="fas fa-play"></i>';
        btn.classList.remove('playing');
    }

    setCurrentPlayingAudio(null);
}

function updateProgressBar(fileId, audio) {
    const progressFill = document.getElementById(`progress_${fileId}`);
    if (!progressFill || !audio.duration) return;

    const percent = (audio.currentTime / audio.duration) * 100;
    progressFill.style.width = `${percent}%`;
}

function updateVoiceDuration(fileId, audio) {
    const durationEl = document.getElementById(`duration_${fileId}`);
    if (!durationEl || !audio.duration) return;

    const remaining = Math.ceil(audio.duration - audio.currentTime);
    durationEl.textContent = formatDuration(remaining);
}

function resetVoiceUI(fileId) {
    const audio = document.getElementById(`audio_${fileId}`);
    const durationEl = document.getElementById(`duration_${fileId}`);
    const progressFill = document.getElementById(`progress_${fileId}`);

    if (audio && durationEl && audio.duration) {
        durationEl.textContent = formatDuration(Math.ceil(audio.duration));
    }

    if (progressFill) {
        progressFill.style.width = '0%';
    }
}

export function seekVoice(event, fileId) {
    event.stopPropagation();

    const audio = document.getElementById(`audio_${fileId}`);
    const progressContainer = event.currentTarget;

    if (!audio || !audio.duration) return;

    const rect = progressContainer.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percent = clickX / rect.width;

    audio.currentTime = percent * audio.duration;
    console.log(`⏩ Seek to ${Math.floor(percent * 100)}%`);
}

export function changeVoiceSpeed(fileId) {
    const audio = document.getElementById(`audio_${fileId}`);
    const speedBtn = document.getElementById(`speed_${fileId}`);

    if (!audio || !speedBtn) return;

    const speeds = [1, 1.5, 2];
    const currentSpeed = audio.playbackRate;
    const nextIndex = (speeds.indexOf(currentSpeed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIndex];

    audio.playbackRate = nextSpeed;
    speedBtn.textContent = `${nextSpeed}x`;

    console.log(`🔊 Speed: ${nextSpeed}x`);
}

// Export to window
window.renderAudioPlayer = renderAudioPlayer;
window.toggleVoicePlay = toggleVoicePlay;
window.seekVoice = seekVoice;
window.changeVoiceSpeed = changeVoiceSpeed;

console.log('✅ voice.js v2.0 loaded');
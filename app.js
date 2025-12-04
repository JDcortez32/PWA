// app.js - Con función de guardado automático de audio
let stream = null;
let currentFacing = 'environment';
let mediaRecorder = null;
let chunks = [];
let beforeInstallEvent = null;
let audioStream = null;
let db = null; // Para IndexedDB

// Estado
let vibrando = false;
let vibrarInterval = null;
let sonando = false;

// Elementos del DOM
const $ = (sel) => document.querySelector(sel);

const video = $('#video');
const canvas = $('#canvas');
const photos = $('#photos');
const audios = $('#audios');
const btnStartCam = $('#btnStartCam');
const btnStopCam = $('#btnStopCam');
const btnFlip = $('#btnFlip');
const btnTorch = $('#btnTorch');
const btnShot = $('#btnShot');
const videoDevices = $('#videoDevices');
const btnStartRec = $('#btnStartRec');
const btnStopRec = $('#btnStopRec');
const recStatus = $('#recStatus');
const btnInstall = $('#btnInstall');
const btnVibrar = $('#btnVibrar');
const btnRingtone = $('#btnRingtone');
const audioCount = $('#audioCount');
const audioContainer = $('#audioContainer');

// ======================
// INSTALACIÓN PWA
// ======================

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    beforeInstallEvent = e;
    btnInstall.hidden = false;
});

btnInstall.addEventListener('click', async () => {
    if (!beforeInstallEvent) return;
    beforeInstallEvent.prompt();
    await beforeInstallEvent.userChoice;
    beforeInstallEvent = null;
    btnInstall.hidden = true;
});

// ======================
// BASE DE DATOS (IndexedDB)
// ======================

const DB_NAME = 'AudioPWA';
const DB_VERSION = 1;
const STORE_NAME = 'audios';

// Inicializar la base de datos
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (e) => {
            console.error('Error al abrir IndexedDB:', e.target.error);
            reject(e.target.error);
        };
        
        request.onsuccess = (e) => {
            db = e.target.result;
            console.log('Base de datos abierta correctamente');
            // Cargar audios guardados al iniciar
            loadAllAudios();
            resolve(db);
        };
        
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            // Crear almacén de audios si no existe
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true
                });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('filename', 'filename', { unique: false });
                console.log('Almacén de audios creado');
            }
        };
    });
}

// Guardar audio en la base de datos
async function saveAudioToDB(audioBlob, filename, duration) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const audioData = {
            blob: audioBlob,
            filename: filename,
            duration: duration,
            timestamp: Date.now(),
            size: audioBlob.size,
            mimeType: audioBlob.type
        };
        
        const request = store.add(audioData);
        
        request.onsuccess = (e) => {
            console.log('Audio guardado en la base de datos con ID:', e.target.result);
            resolve(e.target.result);
        };
        
        request.onerror = (e) => {
            console.error('Error al guardar audio:', e.target.error);
            reject(e.target.error);
        };
    });
}

// Cargar todos los audios guardados
async function loadAllAudios() {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = (e) => {
            const audiosList = e.target.result;
            console.log('Audios cargados:', audiosList.length);
            
            // Ordenar por fecha (más recientes primero)
            audiosList.sort((a, b) => b.timestamp - a.timestamp);
            
            // Mostrar cada audio
            audiosList.forEach(audioData => {
                displayAudio(audioData);
            });
            
            updateAudioCount();
            resolve(audiosList);
        };
        
        request.onerror = (e) => {
            console.error('Error al cargar audios:', e.target.error);
            reject(e.target.error);
        };
    });
}

// Eliminar audio de la base de datos
async function deleteAudioFromDB(id) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        
        request.onsuccess = () => {
            console.log('Audio eliminado:', id);
            resolve(true);
        };
        
        request.onerror = (e) => {
            console.error('Error al eliminar audio:', e.target.error);
            reject(e.target.error);
        };
    });
}

// ======================
// GRABACIÓN DE AUDIO
// ======================

// Iniciar grabación
btnStartRec.addEventListener('click', async () => {
    if (!('MediaRecorder' in window)) {
        alert('MediaRecorder no está disponible en este navegador.');
        return;
    }

    try {
        // Solicitar acceso al micrófono
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });

        // Configurar MediaRecorder
        const options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
            options.mimeType = 'audio/mp4';
        }
        
        mediaRecorder = new MediaRecorder(audioStream, options);
        chunks = [];

        // Configurar eventos
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstart = () => {
            recStatus.textContent = '⏺️ Grabando...';
            recStatus.style.color = '#ff6b6b';
            btnStartRec.disabled = true;
            btnStopRec.disabled = false;
        };

        mediaRecorder.onstop = async () => {
            recStatus.textContent = '✅ Procesando...';
            recStatus.style.color = '#ffa94d';
            
            // Procesar el audio grabado
            await processRecordedAudio();
            
            recStatus.textContent = '✅ Grabación guardada';
            recStatus.style.color = '#51cf66';
            
            btnStartRec.disabled = false;
            btnStopRec.disabled = true;
        };

        mediaRecorder.onerror = (e) => {
            console.error('Error en grabación:', e.error);
            recStatus.textContent = '❌ Error en grabación';
            recStatus.style.color = '#ff6b6b';
            btnStartRec.disabled = false;
            btnStopRec.disabled = true;
        };

        // Iniciar grabación
        mediaRecorder.start();
        
    } catch (err) {
        console.error('Error al acceder al micrófono:', err);
        alert('No se pudo acceder al micrófono: ' + err.message);
        recStatus.textContent = '❌ Error de permisos';
        recStatus.style.color = '#ff6b6b';
    }
});

// Detener grabación
btnStopRec.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        
        // Detener el stream de audio
        if (audioStream) {
            audioStream.getTracks().forEach(track => track.stop());
            audioStream = null;
        }
    }
});

// Procesar el audio grabado
async function processRecordedAudio() {
    if (chunks.length === 0) {
        console.error('No hay datos de audio grabados');
        return;
    }

    const mimeType = mediaRecorder.mimeType || 'audio/webm';
    const blob = new Blob(chunks, { type: mimeType });
    const timestamp = Date.now();
    const date = new Date(timestamp);
    
    // Crear nombre de archivo con fecha
    const filename = `audio_${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}_${date.getHours().toString().padStart(2,'0')}${date.getMinutes().toString().padStart(2,'0')}${date.getSeconds().toString().padStart(2,'0')}.${mimeType.includes('webm') ? 'webm' : 'mp4'}`;
    
    // Calcular duración estimada
    const duration = await estimateAudioDuration(blob);
    
    // Guardar en la base de datos
    try {
        const audioId = await saveAudioToDB(blob, filename, duration);
        console.log('Audio guardado con ID:', audioId);
        
        // Crear y mostrar el elemento de audio
        const audioData = {
            id: audioId,
            blob: blob,
            filename: filename,
            duration: duration,
            timestamp: timestamp,
            size: blob.size
        };
        
        displayAudio(audioData);
        
        // Mostrar notificación
        showNotification('Audio guardado', `"${filename}" se guardó correctamente.`);
        
    } catch (err) {
        console.error('Error al guardar audio:', err);
        alert('Hubo un error al guardar el audio. Intenta nuevamente.');
    }
}

// Mostrar audio en la interfaz
function displayAudio(audioData) {
    const url = URL.createObjectURL(audioData.blob);
    const date = new Date(audioData.timestamp);
    const formattedDate = `${date.getDate()}/${date.getMonth()+1}/${date.getFullYear()} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    const duration = formatDuration(audioData.duration);
    const size = formatFileSize(audioData.size);
    
    // Crear elemento HTML
    const audioElement = document.createElement('div');
    audioElement.className = 'audio-item';
    audioElement.dataset.id = audioData.id;
    
    audioElement.innerHTML = `
        <div class="audio-header">
            <div class="audio-info">
                <strong>${audioData.filename}</strong>
                <div class="audio-details">
                    <span>📅 ${formattedDate}</span>
                    <span>⏱️ ${duration}</span>
                    <span>💾 ${size}</span>
                </div>
            </div>
            <button class="btn-delete" title="Eliminar audio">🗑️</button>
        </div>
        <audio controls src="${url}" preload="metadata" style="width: 100%; margin: 10px 0;"></audio>
        <div class="audio-actions">
            <a href="${url}" download="${audioData.filename}" class="btn-download">📥 Descargar</a>
            <button class="btn-play-pause">▶️ Reproducir</button>
        </div>
    `;
    
    // Configurar eventos
    const audioPlayer = audioElement.querySelector('audio');
    const playBtn = audioElement.querySelector('.btn-play-pause');
    const deleteBtn = audioElement.querySelector('.btn-delete');
    
    // Control de reproducción
    playBtn.addEventListener('click', () => {
        if (audioPlayer.paused) {
            audioPlayer.play();
            playBtn.textContent = '⏸️ Pausar';
        } else {
            audioPlayer.pause();
            playBtn.textContent = '▶️ Reproducir';
        }
    });
    
    audioPlayer.addEventListener('ended', () => {
        playBtn.textContent = '▶️ Reproducir';
    });
    
    audioPlayer.addEventListener('pause', () => {
        playBtn.textContent = '▶️ Reproducir';
    });
    
    // Eliminar audio
    deleteBtn.addEventListener('click', async () => {
        if (confirm('¿Estás seguro de que quieres eliminar este audio?')) {
            try {
                await deleteAudioFromDB(audioData.id);
                audioElement.remove();
                updateAudioCount();
                URL.revokeObjectURL(url); // Liberar memoria
            } catch (err) {
                console.error('Error al eliminar audio:', err);
                alert('No se pudo eliminar el audio.');
            }
        }
    });
    
    // Agregar al contenedor de audios
    audios.appendChild(audioElement);
    
    // Actualizar contador
    updateAudioCount();
}

// ======================
// FUNCIONES AUXILIARES
// ======================

// Calcular duración del audio
async function estimateAudioDuration(blob) {
    return new Promise((resolve) => {
        const audio = new Audio();
        audio.preload = 'metadata';
        
        audio.onloadedmetadata = () => {
            resolve(audio.duration || 0);
            URL.revokeObjectURL(audio.src);
        };
        
        audio.onerror = () => {
            // Estimación basada en tamaño si falla
            const sizeInMB = blob.size / (1024 * 1024);
            resolve(Math.round(sizeInMB * 60)); // Estimación: 1MB ≈ 60 segundos
        };
        
        audio.src = URL.createObjectURL(blob);
    });
}

// Formatear duración
function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0:00';
    
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Formatear tamaño de archivo
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Actualizar contador de audios
function updateAudioCount() {
    const count = audios.children.length;
    audioCount.textContent = `(${count})`;
    
    // Mostrar/ocultar mensaje si no hay audios
    if (count === 0) {
        if (!audios.querySelector('.no-audios-message')) {
            const message = document.createElement('div');
            message.className = 'no-audios-message';
            message.innerHTML = `
                <p style="text-align: center; color: var(--muted); padding: 20px;">
                    No hay audios guardados todavía.<br>
                    <small>Graba un audio usando el botón "🎤 Grabar"</small>
                </p>
            `;
            audios.appendChild(message);
        }
    } else {
        const message = audios.querySelector('.no-audios-message');
        if (message) message.remove();
    }
}

// Mostrar notificación
function showNotification(title, body) {
    if (!('Notification' in window)) return;
    
    if (Notification.permission === 'granted') {
        new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                new Notification(title, { body });
            }
        });
    }
}

// ======================
// CÁMARA (código existente)
// ======================

async function listVideoDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        videoDevices.innerHTML = '';

        const cams = devices.filter(d => d.kind === 'videoinput');
        cams.forEach((cam) => {
            const opt = document.createElement('option');
            opt.value = cam.deviceId;
            opt.textContent = cam.label || `Cámara ${videoDevices.length + 1}`;
            videoDevices.appendChild(opt);
        });
    } catch (err) {
        console.error('Error listando dispositivos:', err);
    }
}

async function startCam(constraints = {}) {
    try {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
        }

        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: currentFacing, ...constraints },
            audio: false
        });

        video.srcObject = stream;

        btnStartCam.disabled = true;
        btnStopCam.disabled = false;
        btnFlip.disabled = false;
        btnTorch.disabled = false;
        btnShot.disabled = false;

        await listVideoDevices();
    } catch (err) {
        alert('No se pudo iniciar la cámara: ' + err.message);
    }
}

function stopCam() {
    if (!stream) return;

    stream.getTracks().forEach(t => t.stop());
    stream = null;
    video.srcObject = null;

    btnStartCam.disabled = false;
    btnStopCam.disabled = true;
    btnFlip.disabled = true;
    btnTorch.disabled = true;
    btnShot.disabled = true;
}

btnStartCam.addEventListener('click', () => startCam());
btnStopCam.addEventListener('click', stopCam);

btnFlip.addEventListener('click', async () => {
    currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
    await startCam();
});

btnTorch.addEventListener('click', async () => {
    if (!stream) return;

    const track = stream.getVideoTracks()[0];
    const cts = track.getConstraints();

    try {
        const torch = !(cts.advanced && cts.advanced[0]?.torch);
        await track.applyConstraints({ advanced: [{ torch }] });
    } catch (err) {
        alert('La linterna no es compatible con este dispositivo / navegador');
    }
});

btnShot.addEventListener('click', () => {
    if (!stream) return;

    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob((blob) => {
        if (!blob) return;

        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `foto-${Date.now()}.png`;
        a.textContent = 'Descargar Foto';
        a.className = 'btn';

        const img = document.createElement('img');
        img.src = url;
        img.alt = 'captura';
        img.style.width = '100%';

        const wrap = document.createElement('div');
        wrap.appendChild(img);
        wrap.appendChild(a);

        photos.prepend(wrap);
    }, 'image/png');
});

// ======================
// VIBRACIÓN Y TONO
// ======================

if (btnVibrar) {
    btnVibrar.addEventListener('click', () => {
        if (!("vibrate" in navigator)) {
            alert("Tu dispositivo o navegador no soporta la vibración.");
            return;
        }

        if (!vibrando) {
            vibrando = true;
            btnVibrar.textContent = "Detener vibración.";
            vibrarInterval = setInterval(() => {
                navigator.vibrate([300, 100]);
            }, 400);
        } else {
            vibrando = false;
            btnVibrar.textContent = "Vibrar";
            clearInterval(vibrarInterval);
            navigator.vibrate(0);
        }
    });
}

let ringtoneAudio = new Audio("assets/old_phone_ring.mp3");
ringtoneAudio.loop = true;

if (btnRingtone) {
    btnRingtone.addEventListener('click', () => {
        if (!sonando) {
            ringtoneAudio.play()
                .then(() => {
                    sonando = true;
                    btnRingtone.textContent = "Detener tono.";
                })
                .catch(err => alert("No se pudo reproducir el tono. " + err.message));
        } else {
            ringtoneAudio.pause();
            ringtoneAudio.currentTime = 0;
            sonando = false;
            btnRingtone.textContent = "Reproducir tono.";
        }
    });
}

// ======================
// EVENTOS GLOBALES
// ======================

window.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopCam();
    }
});

// Inicializar al cargar la página
window.addEventListener('load', async () => {
    // Inicializar base de datos
    await initDB();
    
    // Solicitar permisos de notificación
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
});

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js');
    });
}
// -----------------------------
// Media PWA - app.js (único archivo)
// Compatible con el index.html que me pasaste
// -----------------------------

// Globales
let stream = null;
let mediaRecorder = null;
let chunks = [];
let audioStreamRef = null;
let currentFacing = 'environment';
let beforeInstallEvent = null;

// Helpers
const $ = sel => document.querySelector(sel);

// DOM
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

const btnVibrar = $('#btnVibrar');
const btnRingtone = $('#btnRingtone');
const ringtoneAudio = $('#ringtoneAudio');

const btnInstall = $('#btnInstall');

// -----------------------------
// Service Worker registration
// -----------------------------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err => console.warn('SW register failed:', err));
}

// -----------------------------
// PWA install prompt handling
// -----------------------------
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  beforeInstallEvent = e;
  btnInstall.hidden = false;
});

btnInstall.addEventListener('click', async () => {
  if (!beforeInstallEvent) return;
  beforeInstallEvent.prompt();
  await beforeInstallEvent.userChoice;
  btnInstall.hidden = true;
  beforeInstallEvent = null;
});

// -----------------------------
// Listar cámaras
// -----------------------------
async function listVideoInputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === 'videoinput');
    videoDevices.innerHTML = '';
    cams.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Cámara ${i+1}`;
      videoDevices.appendChild(opt);
    });
    btnFlip.disabled = cams.length <= 1;
  } catch (err) {
    console.warn('No se pudo enumerar dispositivos:', err);
  }
}

// -----------------------------
// Iniciar cámara
// extraConstraints: { deviceId: { exact: '...' } } o {}
// -----------------------------
async function startCam(extraConstraints = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Este navegador no soporta getUserMedia.');
    return;
  }

  try {
    // si ya había stream, detenerlo
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      video.srcObject = null;
    }

    const constraints = {
      video: { facingMode: currentFacing, width: { ideal: 1280 }, height: { ideal: 720 }, ...extraConstraints },
      audio: false
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;

    btnStopCam.disabled = false;
    btnShot.disabled = false;
    btnTorch.disabled = false;

    // Comprobar soporte torch
    const [track] = stream.getVideoTracks();
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    btnTorch.disabled = !('torch' in caps);

    await listVideoInputs();
  } catch (err) {
    alert('No se pudo iniciar la cámara: ' + (err.message || err));
    console.error(err);
  }
}

function stopCam() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
  stream = null;
  video.srcObject = null;

  btnStopCam.disabled = true;
  btnShot.disabled = true;
  btnTorch.disabled = true;
  btnFlip.disabled = true;
}

// -----------------------------
// Eventos cámara
// -----------------------------
btnStartCam.addEventListener('click', () => startCam());
btnStopCam.addEventListener('click', stopCam);

btnFlip.addEventListener('click', async () => {
  currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
  stopCam();
  await startCam();
});

videoDevices.addEventListener('change', async (e) => {
  stopCam();
  await startCam({ deviceId: { exact: e.target.value } });
});

// -----------------------------
// Linterna
// -----------------------------
btnTorch.addEventListener('click', async () => {
  try {
    if (!stream) return;
    const [track] = stream.getVideoTracks();
    if (!track) return;
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (!('torch' in caps)) {
      alert('La linterna no es compatible en este dispositivo o navegador.');
      return;
    }
    // Toggle
    const settings = track.getSettings();
    const torch = !settings.torch;
    await track.applyConstraints({ advanced: [{ torch }] });
    btnTorch.textContent = torch ? 'Linterna ON' : 'Linterna';
  } catch (err) {
    console.warn('Error linterna:', err);
    alert('No se pudo cambiar la linterna: ' + (err.message || err));
  }
});

// -----------------------------
// Tomar foto
// -----------------------------
btnShot.addEventListener('click', () => {
  if (!stream) return;
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');

  // Si cámara frontal (user) queremos espejo corregido en la imagen
  if (currentFacing === 'user') {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -w, 0, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(video, 0, 0, w, h);
  }

  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `foto-${Date.now()}.png`;
    a.textContent = 'Descargar foto';
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

// -----------------------------
// Grabación de audio (MediaRecorder)
// -----------------------------
function supportsRecorder() {
  return 'MediaRecorder' in window;
}

let audioStream = null;

btnStartRec.addEventListener('click', async () => {
  if (!supportsRecorder()) {
    alert('MediaRecorder no está disponible en este navegador.');
    return;
  }

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
    chunks = [];

    // Evitar doble pulsación
    btnStartRec.disabled = true;
    btnStopRec.disabled = true;

    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstart = () => {
      recStatus.textContent = 'Grabando...';
      btnStopRec.disabled = false;
    };

    mediaRecorder.onstop = () => {
      recStatus.textContent = '';
      btnStartRec.disabled = false;
      btnStopRec.disabled = true;

      const blob = new Blob(chunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);

      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = url;

      const link = document.createElement('a');
      link.href = url;
      link.download = `audio-${Date.now()}.webm`;
      link.textContent = 'Descargar audio';
      link.className = 'btn';

      const wrap = document.createElement('div');
      wrap.appendChild(audio);
      wrap.appendChild(link);

      audios.prepend(wrap);

      // Liberar micrófono
      if (audioStream) {
        audioStream.getTracks().forEach(t => t.stop());
        audioStream = null;
      }
    };

    mediaRecorder.start();
  } catch (err) {
    alert('No se pudo iniciar el micrófono: ' + (err.message || err));
    console.error(err);
    btnStartRec.disabled = false;
    btnStopRec.disabled = true;
  }
});

btnStopRec.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  btnStopRec.disabled = true;
});

// -----------------------------
// Vibración
// -----------------------------
btnVibrar.addEventListener('click', () => {
  if (navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  } else {
    alert('API de vibración no disponible en este dispositivo.');
  }
});

// -----------------------------
// Ringtone
// -----------------------------
btnRingtone.addEventListener('click', () => {
  if (!ringtoneAudio) return;
  if (ringtoneAudio.paused) {
    ringtoneAudio.play().catch(err => console.warn('No se pudo reproducir:', err));
    btnRingtone.textContent = 'Pausar tono';
  } else {
    ringtoneAudio.pause();
    ringtoneAudio.currentTime = 0;
    btnRingtone.textContent = 'Reproducir tono';
  }
});

// -----------------------------
// Compartir URL (Web Share API fallback)
// -----------------------------
async function shareAppUrl() {
  const shareData = { title: document.title, text: 'Prueba Media PWA', url: location.href };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch(e){ console.warn('Share canceled', e); }
  } else {
    try { await navigator.clipboard.writeText(location.href); alert('URL copiada al portapapeles'); }
    catch { prompt('Copia la URL', location.href); }
  }
}

// -----------------------------
// Inicialización
// -----------------------------
(async function init() {
  await listVideoInputs();

  // habilitar/deshabilitar botones si no soportado
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    btnStartCam.disabled = true;
    btnStartRec.disabled = true;
  }

  // if no beforeinstallprompt support, hide button
  if (!window.BeforeInstallPromptEvent && !('onbeforeinstallprompt' in window)) {
    btnInstall.hidden = true;
  }
})();

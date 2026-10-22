const capaImgEl = document.getElementById('capa-img');
const capaPrincipalVideoEl = document.getElementById('capa-principal-video');
const capaPrincipalImgEl = document.getElementById('capa-principal-img');
const painelEl = document.getElementById('painel');
const usuarioStatusEl = document.getElementById('usuario-status');
const musicaEl = document.getElementById('musica');
const artistaEl = document.getElementById('artista');
const telaEl = document.getElementById('tela');

const fotoUsuarioEl = document.getElementById('foto-usuario');
const scrobblesContainer = document.getElementById('scrobbles-container');
const totalScrobblesEl = document.getElementById('total-scrobbles');

const opcaoPesquisar = document.getElementById('opcao-pesquisar');
const opcaoUltimo = document.getElementById('opcao-ultimo');
const modalPesquisa = document.getElementById('modal-pesquisa');
const inputBusca = document.getElementById('input-busca');
const btnPesquisarConfirmar = document.getElementById('btn-pesquisar-confirmar');

const IS_LOCAL = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
const SERVER_URL = IS_LOCAL ? 'http://127.0.0.1:5000' : window.location.origin;
const STORAGE_KEY = 'twent_ultimo_usuario';

let intervaloAtualizacao = null;
let ultimaMusica = null;
let ultimaAtualizacao = 0;
let usuarioAtual = null;
let hlsInstance = null;

let urlVideoAtual = null;
let videoEstaTocando = false;
let frameCapturado = false;
let loopTimer = null;

function calcularLuminancia(r, g, b) {
    const canais = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

function bloquearControlesVideo(video) {
    if (!video) return;
    video.controls = false;
    video.disablePictureInPicture = true;
    video.removeAttribute('controls');
    video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback noplaybackrate');
    video.setAttribute('disablepictureinpicture', '');
}

if (capaPrincipalVideoEl) {
    bloquearControlesVideo(capaPrincipalVideoEl);
}

function capturarFrameDoVideo() {
    if (frameCapturado) return;
    if (!capaPrincipalVideoEl || capaPrincipalVideoEl.readyState < 2) return;
    try {
        const canvas = document.createElement('canvas');
        canvas.width = capaPrincipalVideoEl.videoWidth || 1080;
        canvas.height = capaPrincipalVideoEl.videoHeight || 1080;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(capaPrincipalVideoEl, 0, 0, canvas.width, canvas.height);
        capaPrincipalImgEl.src = canvas.toDataURL('image/png');
        frameCapturado = true;
    } catch (e) { console.log('❌ Erro frame:', e); }
}

function iniciarLoopVideo(videoEl) {
    if (loopTimer) clearInterval(loopTimer);
    loopTimer = setInterval(() => {
        if (!videoEl || !videoEl.duration || isNaN(videoEl.duration)) return;
        if (videoEl.duration - videoEl.currentTime <= 0.4) {
            videoEl.currentTime = 0;
        }
    }, 50);
}

function tocarHLS(videoEl, url, staticUrl) {
    if (!videoEl) return;
    if (urlVideoAtual === url && videoEstaTocando) return;

    urlVideoAtual = url;
    videoEstaTocando = false;
    frameCapturado = false;
    
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    
    if (staticUrl && staticUrl.trim() !== "") capaPrincipalImgEl.src = staticUrl;

    videoEl.style.display = 'block';
    videoEl.currentTime = 0;

    videoEl.addEventListener('playing', function onPlaying() {
        videoEl.removeEventListener('playing', onPlaying);
        videoEstaTocando = true;
        setTimeout(capturarFrameDoVideo, 500);
        iniciarLoopVideo(videoEl);
    }, { once: true });

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = url;
        videoEl.play().catch(() => {});
    } else if (window.Hls && window.Hls.isSupported()) {
        hlsInstance = new window.Hls({ enableWorker: true });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
            videoEl.play().catch(() => {});
        });
    }
}

function tocarCapaPadrao(staticUrl, videoUrl) {
    if (staticUrl && staticUrl.trim() !== "") {
        capaPrincipalImgEl.src = staticUrl;
        capaImgEl.src = staticUrl;
        capaImgEl.classList.add('visivel');
    }
    if (videoUrl && videoUrl.trim() !== "") {
        tocarHLS(capaPrincipalVideoEl, videoUrl, staticUrl);
    } else {
        urlVideoAtual = null;
        videoEstaTocando = false;
        if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
        capaPrincipalVideoEl.style.display = 'none';
        capaPrincipalVideoEl.pause();
        if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    }
}

async function carregarLastFm(userEspecifico = null, forcar = false) {
    const user = userEspecifico || usuarioAtual || inputBusca.value.trim();
    if (!user) return;
    usuarioAtual = user;
    localStorage.setItem(STORAGE_KEY, user);

    try {
        const response = await fetch(`${SERVER_URL}/api/lastfm/now-playing?user=${encodeURIComponent(user)}`);
        const data = await response.json();
        if (data.error || !data.track || !data.artist) return;

        const assinaturaAtual = `${data.artist}::${data.track}::${data.album}`;
        const agora = Date.now();
        const passouTempo = agora - ultimaAtualizacao > 30000;
        if (assinaturaAtual === ultimaMusica && !passouTempo && !forcar) return;

        ultimaMusica = assinaturaAtual;
        ultimaAtualizacao = agora;

        painelEl.classList.add('visivel');
        usuarioStatusEl.textContent = user;
        musicaEl.textContent = data.track;
        artistaEl.textContent = data.artist;

        if (data.user_image && data.user_image.trim() !== "") {
            fotoUsuarioEl.src = data.user_image;
            fotoUsuarioEl.style.display = 'block';
        } else {
            fotoUsuarioEl.style.display = 'none';
        }

        if (data.scrobbles !== undefined && data.scrobbles !== null) {
            totalScrobblesEl.textContent = `${data.scrobbles.toLocaleString('pt-BR')} scrobbles`;
            scrobblesContainer.style.display = 'flex';
        } else {
            scrobblesContainer.style.display = 'none';
        }

        tocarCapaPadrao(data.static_url, data.video_url);

        if (data.dominant_color) {
            let { r, g, b } = data.dominant_color;
            const lum = calcularLuminancia(r, g, b);
            if (lum > 0.5) { r = Math.round(r * 0.6); g = Math.round(g * 0.6); b = Math.round(b * 0.6); }
            telaEl.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
        }
    } catch (error) {
        console.error('Erro Last.fm:', error);
    }
}

function iniciarAtualizacaoAutomatica(user) {
    const alvo = user || inputBusca.value.trim();
    if (!alvo) return alert('Digite um nome de usuário do Last.fm.');
    if (intervaloAtualizacao) clearInterval(intervaloAtualizacao);
    ultimaMusica = null;
    ultimaAtualizacao = 0;
    urlVideoAtual = null;
    videoEstaTocando = false;
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    carregarLastFm(alvo, true);
    intervaloAtualizacao = setInterval(() => carregarLastFm(alvo, true), 2000); 
}

if (opcaoPesquisar) {
    opcaoPesquisar.addEventListener('click', (e) => {
        e.stopPropagation();
        modalPesquisa.classList.add('ativo');
        inputBusca.focus();
    });
}

if (opcaoUltimo) {
    opcaoUltimo.addEventListener('click', (e) => {
        e.stopPropagation();
        const ultimo = localStorage.getItem(STORAGE_KEY);
        if (!ultimo) return alert('Nenhum usuário pesquisado ainda.');
        inputBusca.value = ultimo;
        iniciarAtualizacaoAutomatica(ultimo);
    });
}

if (btnPesquisarConfirmar) {
    btnPesquisarConfirmar.addEventListener('click', (e) => {
        e.stopPropagation();
        const user = inputBusca.value.trim();
        if (!user) return;
        modalPesquisa.classList.remove('ativo');
        iniciarAtualizacaoAutomatica(user);
    });
}

if (inputBusca) {
    inputBusca.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const user = inputBusca.value.trim();
            if (!user) return;
            modalPesquisa.classList.remove('ativo');
            iniciarAtualizacaoAutomatica(user);
        }
        if (e.key === 'Escape') {
            modalPesquisa.classList.remove('ativo');
        }
    });
}

if (modalPesquisa) {
    modalPesquisa.addEventListener('click', (e) => {
        if (e.target === modalPesquisa) {
            modalPesquisa.classList.remove('ativo');
        }
    });
}

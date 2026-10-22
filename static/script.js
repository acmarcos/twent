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

// CONTROLE DO DOUBLE BUFFER
let video1 = null;
let video2 = null;
let videoAtivo = 1;
let hls1 = null;
let hls2 = null;
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

// --- SISTEMA DOUBLE BUFFER PARA HLS ---
function criarVideoOculto() {
    const v = document.createElement('video');
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    bloquearControlesVideo(v);
    v.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; object-fit:cover; object-position:center center; opacity:0; z-index:1; pointer-events:none;';
    document.getElementById('capa-central').appendChild(v);
    return v;
}

function iniciarDoubleBuffer(url) {
    if (loopTimer) clearInterval(loopTimer);
    if (hls1) { hls1.destroy(); hls1 = null; }
    if (hls2) { hls2.destroy(); hls2 = null; }
    
    const oldV1 = document.getElementById('dummy-v1');
    const oldV2 = document.getElementById('dummy-v2');
    if (oldV1) oldV1.remove();
    if (oldV2) oldV2.remove();

    capaPrincipalVideoEl.classList.remove('playing');
    capaPrincipalVideoEl.style.display = 'none';

    video1 = criarVideoOculto();
    video1.id = 'dummy-v1';
    video2 = criarVideoOculto();
    video2.id = 'dummy-v2';

    if (window.Hls && window.Hls.isSupported()) {
        hls1 = new window.Hls({ enableWorker: true });
        hls1.loadSource(url);
        hls1.attachMedia(video1);
        hls1.on(window.Hls.Events.MANIFEST_PARSED, () => { video1.play().catch(()=>{}); });

        hls2 = new window.Hls({ enableWorker: true });
        hls2.loadSource(url);
        hls2.attachMedia(video2);
        hls2.on(window.Hls.Events.MANIFEST_PARSED, () => { video2.pause(); });
    }

    video1.style.opacity = '1';
    video1.style.zIndex = '2';
    video2.style.opacity = '0';
    video2.style.zIndex = '1';
    videoAtivo = 1;

    loopTimer = setInterval(() => {
        const videoAtual = videoAtivo === 1 ? video1 : video2;
        const videoProximo = videoAtivo === 1 ? video2 : video1;

        if (!videoAtual.duration || isNaN(videoAtual.duration)) return;

        if (videoAtual.duration - videoAtual.currentTime <= 0.5) {
            videoProximo.currentTime = 0;
            videoProximo.play().catch(()=>{});
            
            videoProximo.style.zIndex = '2';
            videoProximo.style.opacity = '1';
            videoAtual.style.zIndex = '1';
            videoAtual.style.opacity = '0';

            videoAtivo = videoAtivo === 1 ? 2 : 1;
        }
    }, 50);
}

function pararDoubleBuffer() {
    if (loopTimer) { clearInterval(loopTimer); loopTimer = null; }
    if (hls1) { hls1.destroy(); hls1 = null; }
    if (hls2) { hls2.destroy(); hls2 = null; }
    
    const oldV1 = document.getElementById('dummy-v1');
    const oldV2 = document.getElementById('dummy-v2');
    if (oldV1) oldV1.remove();
    if (oldV2) oldV2.remove();
    
    capaPrincipalVideoEl.style.display = 'none';
    capaPrincipalVideoEl.classList.remove('playing');
}

function tocarCapaPadrao(staticUrl, videoUrl) {
    if (staticUrl && staticUrl.trim() !== "") {
        capaPrincipalImgEl.src = staticUrl;
        capaImgEl.src = staticUrl;
        capaImgEl.classList.add('visivel');
    }

    if (videoUrl && videoUrl.trim() !== "") {
        capaPrincipalImgEl.style.display = 'none';
        iniciarDoubleBuffer(videoUrl);
    } else {
        capaPrincipalImgEl.style.display = 'block';
        pararDoubleBuffer();
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
        console.error('Erro ao buscar Last.fm:', error);
    }
}

function iniciarAtualizacaoAutomatica(user) {
    const alvo = user || inputBusca.value.trim();
    if (!alvo) return alert('Digite um nome de usuário do Last.fm.');
    if (intervaloAtualizacao) clearInterval(intervaloAtualizacao);
    ultimaMusica = null;
    ultimaAtualizacao = 0;
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

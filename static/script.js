const capaImgEl = document.getElementById('capa-img');
const capaPrincipalVideoEl = document.getElementById('capa-principal-video');
const capaPrincipalImgEl = document.getElementById('capa-principal-img');
const painelEl = document.getElementById('painel');
const telaEl = document.getElementById('tela');
const usuarioStatusEl = document.getElementById('usuario-status');
const albumEl = document.getElementById('album');
const musicaEl = document.getElementById('musica');
const artistaEl = document.getElementById('artista');

const assistiveEl = document.getElementById('assistive');
const assistiveBtn = document.getElementById('assistive-btn');
const opcaoPesquisar = document.getElementById('opcao-pesquisar');
const opcaoUltimo = document.getElementById('opcao-ultimo');
const opcaoCaptura = document.getElementById('opcao-captura');
const modalPesquisa = document.getElementById('modal-pesquisa');
const modalVoltar = document.getElementById('modal-voltar');
const inputBusca = document.getElementById('input-busca');
const btnPesquisarConfirmar = document.getElementById('btn-pesquisar-confirmar');

const SERVER_URL = window.location.origin;
const STORAGE_KEY = 'twent_ultimo_usuario';

let intervaloAtualizacao = null;
let ultimaMusica = null;
let usuarioAtual = null;
let hlsInstance = null;

// ============================================
// BLOQUEIO DE ZOOM (3 camadas de defesa)
// ============================================

// Camada 1: bloqueia gesto de pinça (2 dedos)
document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) {
        e.preventDefault();
    }
}, { passive: false });

// Camada 2: bloqueia duplo-toque (zoom rápido)
let ultimoToque = 0;
document.addEventListener('touchend', (e) => {
    const agora = Date.now();
    if (agora - ultimoToque <= 300) {
        e.preventDefault();
    }
    ultimoToque = agora;
}, { passive: false });

// Camada 3: bloqueia gesto de pinça (evento específico)
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => e.preventDefault());

// Camada 4: bloqueia zoom via Ctrl + scroll (desktop)
document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });

// Camada 5: bloqueia Ctrl + "+" / "-" / "0" (desktop)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
    }
});

// ============================================
// FIM DO BLOQUEIO DE ZOOM
// ============================================

// --- GARANTE QUE O VÍDEO NUNCA TENHA CONTROLES ---
function bloquearControlesVideo(video) {
    if (!video) return;
    video.controls = false;
    video.disablePictureInPicture = true;
    video.removeAttribute('controls');
    video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback noplaybackrate');
    video.setAttribute('disablepictureinpicture', '');
}

bloquearControlesVideo(capaPrincipalVideoEl);

capaPrincipalVideoEl.addEventListener('enterpictureinpicture', () => {
    if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
    }
});

capaPrincipalVideoEl.addEventListener('contextmenu', (e) => e.preventDefault());
capaPrincipalVideoEl.addEventListener('click', (e) => e.preventDefault());
capaPrincipalVideoEl.addEventListener('dblclick', (e) => e.preventDefault());
capaPrincipalVideoEl.addEventListener('pause', () => {
    capaPrincipalVideoEl.play().catch(() => {});
});

// --- TOCA HLS em qualquer navegador (com hls.js) ---
function tocarVideoHLS(url) {
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    capaPrincipalVideoEl.style.display = 'block';
    capaPrincipalImgEl.style.display = 'none';
    bloquearControlesVideo(capaPrincipalVideoEl);

    // Safari/iOS suportam HLS nativo
    if (capaPrincipalVideoEl.canPlayType('application/vnd.apple.mpegurl')) {
        capaPrincipalVideoEl.src = url;
        capaPrincipalVideoEl.play().catch(() => {});
        return;
    }

    // Chrome/Firefox/Edge usam hls.js
    if (window.Hls && window.Hls.isSupported()) {
        hlsInstance = new window.Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 90
        });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(capaPrincipalVideoEl);
        hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
            capaPrincipalVideoEl.play().catch(() => {});
        });
        hlsInstance.on(window.Hls.Events.ERROR, (event, data) => {
            console.warn('Erro HLS:', data);
            if (data.fatal) {
                if (capaPrincipalImgEl.src) {
                    capaPrincipalVideoEl.style.display = 'none';
                    capaPrincipalImgEl.style.display = 'block';
                }
            }
        });
        return;
    }

    // Fallback
    capaPrincipalVideoEl.src = url;
    capaPrincipalVideoEl.play().catch(() => {});
}

async function carregarLastFm(userEspecifico = null) {
    const user = userEspecifico || usuarioAtual || inputBusca.value.trim();
    if (!user) return;

    usuarioAtual = user;
    localStorage.setItem(STORAGE_KEY, user);

    try {
        const response = await fetch(`${SERVER_URL}/api/lastfm/now-playing?user=${encodeURIComponent(user)}`);
        const data = await response.json();

        if (data.error || !data.track || !data.artist) {
            console.warn('Sem dados no momento:', data.error || 'dados incompletos');
            return;
        }

        const assinaturaAtual = `${data.artist}::${data.track}::${data.album}`;
        if (assinaturaAtual === ultimaMusica) {
            return;
        }
        ultimaMusica = assinaturaAtual;

        painelEl.classList.add('visivel');
        usuarioStatusEl.textContent = user;
        albumEl.textContent = data.album || '';
        musicaEl.textContent = data.track;
        artistaEl.textContent = data.artist;

        if (data.static_url) {
            capaPrincipalImgEl.src = data.static_url;
            capaImgEl.src = data.static_url;
            capaImgEl.classList.add('visivel');
        }

        if (data.video_url) {
            tocarVideoHLS(data.video_url);
        } else if (data.static_url) {
            capaPrincipalImgEl.style.display = 'block';
            capaPrincipalVideoEl.style.display = 'none';
            capaPrincipalVideoEl.pause();
        }

        if (data.dominant_color) {
            const { r, g, b } = data.dominant_color;
            const fator = 0.5;
            telaEl.style.backgroundColor = `rgb(${Math.round(r * fator)}, ${Math.round(g * fator)}, ${Math.round(b * fator)})`;
        }

    } catch (error) {
        console.error('Erro ao buscar Last.fm:', error);
    }
}

function iniciarAtualizacaoAutomatica(user) {
    const alvo = user || inputBusca.value.trim();
    if (!alvo) {
        alert('Digite um nome de usuário do Last.fm.');
        return;
    }

    if (intervaloAtualizacao) {
        clearInterval(intervaloAtualizacao);
    }

    ultimaMusica = null;
    carregarLastFm(alvo);

    intervaloAtualizacao = setInterval(() => {
        carregarLastFm(alvo);
    }, 10000);
}

// --- CAPTURA DE TELA ---
async function capturarTela() {
    try {
        assistiveEl.classList.remove('aberto');
        assistiveEl.style.visibility = 'hidden';

        await new Promise(r => setTimeout(r, 100));

        const canvas = await html2canvas(document.body, {
            backgroundColor: null,
            useCORS: true,
            allowTaint: false,
            scale: window.devicePixelRatio || 2,
            logging: false
        });

        const link = document.createElement('a');
        link.download = `twent-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        console.error('Erro na captura:', error);
        alert('Não foi possível capturar a tela.');
    } finally {
        assistiveEl.style.visibility = '';
    }
}

// --- EVENTOS ---

assistiveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    assistiveEl.classList.toggle('aberto');
});

document.addEventListener('click', (e) => {
    if (!assistiveEl.contains(e.target)) {
        assistiveEl.classList.remove('aberto');
    }
});

opcaoPesquisar.addEventListener('click', (e) => {
    e.stopPropagation();
    assistiveEl.classList.remove('aberto');
    modalPesquisa.classList.add('ativo');
    inputBusca.focus();
});

opcaoUltimo.addEventListener('click', (e) => {
    e.stopPropagation();
    assistiveEl.classList.remove('aberto');

    const ultimo = localStorage.getItem(STORAGE_KEY);
    if (!ultimo) {
        alert('Nenhum usuário pesquisado ainda.');
        return;
    }

    inputBusca.value = ultimo;
    iniciarAtualizacaoAutomatica(ultimo);
});

opcaoCaptura.addEventListener('click', (e) => {
    e.stopPropagation();
    capturarTela();
});

btnPesquisarConfirmar.addEventListener('click', () => {
    const user = inputBusca.value.trim();
    if (!user) return;
    modalPesquisa.classList.remove('ativo');
    iniciarAtualizacaoAutomatica(user);
});

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

modalVoltar.addEventListener('click', (e) => {
    e.stopPropagation();
    modalPesquisa.classList.remove('ativo');
    inputBusca.value = '';
});

// --- ARRASTAR O BOTÃO FLUTUANTE ---
let arrastando = false;
let offsetX, offsetY;

assistiveBtn.addEventListener('mousedown', (e) => {
    arrastando = true;
    const rect = assistiveEl.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    assistiveEl.style.transition = 'none';
    e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
    if (!arrastando) return;
    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;
    const largura = assistiveBtn.offsetWidth;
    const altura = assistiveBtn.offsetHeight;
    const maxX = window.innerWidth - largura;
    const maxY = window.innerHeight - altura;
    assistiveEl.style.left = Math.max(0, Math.min(maxX, x)) + 'px';
    assistiveEl.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
    assistiveEl.style.right = 'auto';
    assistiveEl.style.bottom = 'auto';
});

document.addEventListener('mouseup', () => {
    if (arrastando) {
        assistiveEl.style.transition = '';
        arrastando = false;
    }
});

assistiveBtn.addEventListener('touchstart', (e) => {
    arrastando = true;
    const rect = assistiveEl.getBoundingClientRect();
    offsetX = e.touches[0].clientX - rect.left;
    offsetY = e.touches[0].clientY - rect.top;
    assistiveEl.style.transition = 'none';
}, { passive: true });

document.addEventListener('touchmove', (e) => {
    if (!arrastando) return;
    const x = e.touches[0].clientX - offsetX;
    const y = e.touches[0].clientY - offsetY;
    const largura = assistiveBtn.offsetWidth;
    const altura = assistiveBtn.offsetHeight;
    const maxX = window.innerWidth - largura;
    const maxY = window.innerHeight - altura;
    assistiveEl.style.left = Math.max(0, Math.min(maxX, x)) + 'px';
    assistiveEl.style.top = Math.max(0, Math.min(maxY, y)) + 'px';
    assistiveEl.style.right = 'auto';
    assistiveEl.style.bottom = 'auto';
}, { passive: true });

document.addEventListener('touchend', () => {
    if (arrastando) {
        assistiveEl.style.transition = '';
        arrastando = false;
    }
});

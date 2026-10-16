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
const opcaoCapas = document.getElementById('opcao-capas');
const opcaoCaptura = document.getElementById('opcao-captura');
const modalPesquisa = document.getElementById('modal-pesquisa');
const modalVoltar = document.getElementById('modal-voltar');
const inputBusca = document.getElementById('input-busca');
const btnPesquisarConfirmar = document.getElementById('btn-pesquisar-confirmar');

const modalCapas = document.getElementById('modal-capas');
const modalCapasFechar = document.getElementById('modal-capas-fechar');
const modalCapasInfo = document.getElementById('modal-capas-info');
const gradeCapas = document.getElementById('grade-capas');

const SERVER_URL = window.location.origin;
const STORAGE_KEY = 'twent_ultimo_usuario';
const STORAGE_CAPAS_CUSTOM = 'twent_capas_custom';

let intervaloAtualizacao = null;
let ultimaMusica = null;
let usuarioAtual = null;
let musicaAtual = null;
let hlsInstance = null;

// ============================================
// BLOQUEIO DE ZOOM
// ============================================
document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

let ultimoToque = 0;
document.addEventListener('touchend', (e) => {
    const agora = Date.now();
    if (agora - ultimoToque <= 300) e.preventDefault();
    ultimoToque = agora;
}, { passive: false });

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => e.preventDefault());

document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault();
}, { passive: false });

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
        e.preventDefault();
    }
});

// ============================================
// VÍDEO
// ============================================
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

function tocarVideoHLS(url) {
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    capaPrincipalVideoEl.style.display = 'block';
    capaPrincipalImgEl.style.display = 'none';
    bloquearControlesVideo(capaPrincipalVideoEl);

    if (capaPrincipalVideoEl.canPlayType('application/vnd.apple.mpegurl')) {
        capaPrincipalVideoEl.src = url;
        capaPrincipalVideoEl.play().catch(() => {});
        return;
    }

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

    capaPrincipalVideoEl.src = url;
    capaPrincipalVideoEl.play().catch(() => {});
}

// ============================================
// CAPAS CUSTOMIZADAS
// ============================================
function carregarCapasCustom() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_CAPAS_CUSTOM) || '{}');
    } catch {
        return {};
    }
}

function salvarCapasCustom(dados) {
    localStorage.setItem(STORAGE_CAPAS_CUSTOM, JSON.stringify(dados));
}

function aplicarCapaCustom(artist, track) {
    const chave = `${artist}::${track}`;
    const custom = carregarCapasCustom()[chave];
    if (!custom) return false;

    if (custom.tipo === 'animada' && custom.url) {
        tocarVideoHLS(custom.url);
        return true;
    } else if (custom.tipo === 'estatica' && custom.url) {
        capaPrincipalImgEl.src = custom.url;
        capaPrincipalImgEl.style.display = 'block';
        capaPrincipalVideoEl.style.display = 'none';
        capaPrincipalVideoEl.pause();
        return true;
    }
    return false;
}

// ============================================
// MODAL DE CAPAS
// ============================================
async function abrirModalCapas() {
    if (!musicaAtual) {
        alert('Nenhuma música tocando.');
        return;
    }

    assistiveEl.classList.remove('aberto');
    modalCapas.classList.add('ativo');
    gradeCapas.innerHTML = '';
    modalCapasInfo.textContent = 'Carregando capas...';

    const { artist, track } = musicaAtual;

    try {
        const url = `${SERVER_URL}/api/capas-alternativas?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}`;
        const resp = await fetch(url);
        const capas = await resp.json();

        if (!Array.isArray(capas) || capas.length === 0) {
            modalCapasInfo.textContent = 'Nenhuma capa alternativa encontrada.';
            return;
        }

        modalCapasInfo.textContent = `${capas.length} capas encontradas. Toque numa pra escolher.`;

        const custom = carregarCapasCustom();
        const chave = `${artist}::${track}`;
        const escolhidaAtual = custom[chave];
        const urlAtual = escolhidaAtual ? escolhidaAtual.url : null;

        capas.forEach((c) => {
            const div = document.createElement('div');
            div.className = 'capa-opcao';

            if (urlAtual && (urlAtual === c.video_url || urlAtual === c.static_url)) {
                div.classList.add('selecionada');
            }

            if (c.tem_animada && c.video_url) {
                const video = document.createElement('video');
                video.src = c.video_url;
                video.autoplay = true;
                video.loop = true;
                video.muted = true;
                video.playsInline = true;
                video.setAttribute('disablepictureinpicture', '');
                video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
                div.appendChild(video);

                const badge = document.createElement('div');
                badge.className = 'capa-badge';
                badge.textContent = 'ANIMADA';
                div.appendChild(badge);
            } else {
                const img = document.createElement('img');
                img.src = c.static_url;
                img.alt = c.album;
                div.appendChild(img);
            }

            const nome = document.createElement('div');
            nome.className = 'capa-album-nome';
            nome.textContent = c.album || 'Sem nome';
            div.appendChild(nome);

            div.addEventListener('click', () => {
                gradeCapas.querySelectorAll('.capa-opcao').forEach(el => el.classList.remove('selecionada'));
                div.classList.add('selecionada');

                const dados = carregarCapasCustom();
                if (c.tem_animada && c.video_url) {
                    dados[chave] = { tipo: 'animada', url: c.video_url };
                } else {
                    dados[chave] = { tipo: 'estatica', url: c.static_url };
                }
                salvarCapasCustom(dados);
                aplicarCapaCustom(artist, track);
            });

            gradeCapas.appendChild(div);
        });
    } catch (error) {
        console.error('Erro ao buscar capas:', error);
        modalCapasInfo.textContent = 'Erro ao buscar capas.';
    }
}

modalCapasFechar.addEventListener('click', () => {
    modalCapas.classList.remove('ativo');
});

modalCapas.addEventListener('click', (e) => {
    if (e.target === modalCapas) {
        modalCapas.classList.remove('ativo');
    }
});

// ============================================
// LAST.FM
// ============================================
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
        if (assinaturaAtual === ultimaMusica) return;
        ultimaMusica = assinaturaAtual;

        painelEl.classList.add('visivel');
        usuarioStatusEl.textContent = user;
        albumEl.textContent = data.album || '';
        musicaEl.textContent = data.track;
        artistaEl.textContent = data.artist;

        musicaAtual = { artist: data.artist, track: data.track };

        if (data.static_url) {
            capaPrincipalImgEl.src = data.static_url;
            capaImgEl.src = data.static_url;
            capaImgEl.classList.add('visivel');
        }

        const temCustom = aplicarCapaCustom(data.artist, data.track);

        if (!temCustom) {
            if (data.video_url) {
                tocarVideoHLS(data.video_url);
            } else if (data.static_url) {
                capaPrincipalImgEl.style.display = 'block';
                capaPrincipalVideoEl.style.display = 'none';
                capaPrincipalVideoEl.pause();
            }
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

    if (intervaloAtualizacao) clearInterval(intervaloAtualizacao);

    ultimaMusica = null;
    carregarLastFm(alvo);

    intervaloAtualizacao = setInterval(() => {
        carregarLastFm(alvo);
    }, 10000);
}

// ============================================
// CAPTURA DE TELA
// ============================================
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

// ============================================
// EVENTOS
// ============================================
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

opcaoCapas.addEventListener('click', (e) => {
    e.stopPropagation();
    abrirModalCapas();
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

// ============================================
// ARRASTAR BOTÃO FLUTUANTE
// ============================================
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

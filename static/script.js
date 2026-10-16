const capaImgEl = document.getElementById('capa-img');

// Painel padrão
const capaPrincipalVideoEl = document.getElementById('capa-principal-video');
const capaPrincipalImgEl = document.getElementById('capa-principal-img');
const painelEl = document.getElementById('painel');
const usuarioStatusEl = document.getElementById('usuario-status');
const albumEl = document.getElementById('album');
const musicaEl = document.getElementById('musica');
const artistaEl = document.getElementById('artista');

// Painel capa cheia
const painelCapaCheiaEl = document.getElementById('painel-capa-cheia');
const capaCheiaVideoEl = document.getElementById('capa-cheia-video');
const capaCheiaImgEl = document.getElementById('capa-cheia-img');
const capaCheiaGradienteEl = document.getElementById('capa-cheia-gradiente');
const usuarioStatusCheioEl = document.getElementById('usuario-status-cheio');
const albumCheioEl = document.getElementById('album-cheio');
const musicaCheioEl = document.getElementById('musica-cheio');
const artistaCheioEl = document.getElementById('artista-cheio');

const telaEl = document.getElementById('tela');

const assistiveEl = document.getElementById('assistive');
const assistiveBtn = document.getElementById('assistive-btn');
const opcaoPesquisar = document.getElementById('opcao-pesquisar');
const opcaoUltimo = document.getElementById('opcao-ultimo');
const opcaoCapas = document.getElementById('opcao-capas');
const opcaoVisual = document.getElementById('opcao-visual');
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
const STORAGE_VISUAL = 'twent_visual';

let intervaloAtualizacao = null;
let ultimaMusica = null;
let usuarioAtual = null;
let musicaAtual = null;
let hlsInstance = null;
let hlsCheiaInstance = null;
let visualAtual = 'padrao';

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
// VISUAL
// ============================================
function aplicarVisual(visual) {
    visualAtual = visual;
    localStorage.setItem(STORAGE_VISUAL, visual);

    if (visual === 'capa-cheia') {
        document.body.classList.add('visual-capa-cheia');
        if (musicaAtual) {
            const dadosAtuais = obterDadosAtuais();
            if (dadosAtuais) atualizarPainelCapaCheia(dadosAtuais);
        }
    } else {
        document.body.classList.remove('visual-capa-cheia');
    }
}

function carregarVisualSalvo() {
    const salvo = localStorage.getItem(STORAGE_VISUAL) || 'padrao';
    aplicarVisual(salvo);
}

// ============================================
// VÍDEO — CONTROLE GERAL
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
bloquearControlesVideo(capaCheiaVideoEl);

[capaPrincipalVideoEl, capaCheiaVideoEl].forEach((v) => {
    v.addEventListener('enterpictureinpicture', () => {
        if (document.pictureInPictureElement) {
            document.exitPictureInPicture().catch(() => {});
        }
    });
    v.addEventListener('contextmenu', (e) => e.preventDefault());
    v.addEventListener('click', (e) => e.preventDefault());
    v.addEventListener('dblclick', (e) => e.preventDefault());
    v.addEventListener('pause', () => v.play().catch(() => {}));
});

// ============================================
// TOCAR HLS
// ============================================
function tocarHLS(videoEl, url, onHlsInstance) {
    if (!videoEl) return;

    const anterior = onHlsInstance ? onHlsInstance() : null;
    if (anterior) anterior.destroy();

    videoEl.style.display = 'block';
    bloquearControlesVideo(videoEl);

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = url;
        videoEl.play().catch(() => {});
        return null;
    }

    if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 90
        });
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            videoEl.play().catch(() => {});
        });
        hls.on(window.Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.warn('Erro HLS:', data);
                videoEl.style.display = 'none';
            }
        });
        return hls;
    }

    videoEl.src = url;
    videoEl.play().catch(() => {});
    return null;
}

// ============================================
// TOCAR CAPA NO PAINEL PADRÃO
// ============================================
function tocarCapaPadrao(staticUrl, videoUrl) {
    if (staticUrl) {
        capaPrincipalImgEl.src = staticUrl;
    }

    if (videoUrl) {
        capaPrincipalImgEl.style.display = 'none';
        hlsInstance = tocarHLS(capaPrincipalVideoEl, videoUrl, () => hlsInstance);
    } else if (staticUrl) {
        capaPrincipalVideoEl.style.display = 'none';
        capaPrincipalVideoEl.pause();
        capaPrincipalImgEl.style.display = 'block';
    }
}

// ============================================
// TOCAR CAPA NO PAINEL CAPA CHEIA
// ============================================
function tocarCapaCheia(staticUrl, videoUrl) {
    if (staticUrl) {
        capaCheiaImgEl.src = staticUrl;
    }

    if (videoUrl) {
        capaCheiaImgEl.style.display = 'none';
        hlsCheiaInstance = tocarHLS(capaCheiaVideoEl, videoUrl, () => hlsCheiaInstance);
    } else if (staticUrl) {
        capaCheiaVideoEl.style.display = 'none';
        capaCheiaVideoEl.pause();
        capaCheiaImgEl.style.display = 'block';
    }
}

// ============================================
// DADOS ATUAIS
// ============================================
let dadosMusicaAtual = null;

function obterDadosAtuais() {
    return dadosMusicaAtual;
}

// ============================================
// ATUALIZA O PAINEL CAPA CHEIA
// ============================================
function atualizarPainelCapaCheia(data) {
    if (!data) return;

    usuarioStatusCheioEl.textContent = data.usuario || '—';
    albumCheioEl.textContent = data.album || '';
    musicaCheioEl.textContent = data.track || '';
    artistaCheioEl.textContent = data.artist || '';

    if (data.dominant_color) {
        const { r, g, b } = data.dominant_color;
        const fator = 0.5;
        const rF = Math.round(r * fator);
        const gF = Math.round(g * fator);
        const bF = Math.round(b * fator);

        painelCapaCheiaEl.style.backgroundColor = `rgb(${rF}, ${gF}, ${bF})`;

        document.documentElement.style.setProperty('--cor-r', rF);
        document.documentElement.style.setProperty('--cor-g', gF);
        document.documentElement.style.setProperty('--cor-b', bF);
    }

    tocarCapaCheia(data.static_url, data.video_url);
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

function obterCapaCustom(artist, track) {
    const chave = `${artist}::${track}`;
    return carregarCapasCustom()[chave] || null;
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

                if (dadosMusicaAtual) {
                    if (c.tem_animada && c.video_url) {
                        dadosMusicaAtual.video_url = c.video_url;
                        dadosMusicaAtual.static_url = c.static_url;
                    } else {
                        dadosMusicaAtual.video_url = null;
                        dadosMusicaAtual.static_url = c.static_url;
                    }
                    tocarCapaPadrao(dadosMusicaAtual.static_url, dadosMusicaAtual.video_url);
                    tocarCapaCheia(dadosMusicaAtual.static_url, dadosMusicaAtual.video_url);
                }
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

        const capaCustom = obterCapaCustom(data.artist, data.track);
        let staticUrl = data.static_url;
        let videoUrl = data.video_url;

        if (capaCustom) {
            if (capaCustom.tipo === 'animada') {
                videoUrl = capaCustom.url;
            } else {
                staticUrl = capaCustom.url;
                videoUrl = null;
            }
        }

        dadosMusicaAtual = {
            usuario: user,
            artist: data.artist,
            track: data.track,
            album: data.album,
            static_url: staticUrl,
            video_url: videoUrl,
            dominant_color: data.dominant_color
        };

        musicaAtual = { artist: data.artist, track: data.track };

        // Painel padrão
        painelEl.classList.add('visivel');
        usuarioStatusEl.textContent = user;
        albumEl.textContent = data.album || '';
        musicaEl.textContent = data.track;
        artistaEl.textContent = data.artist;

        if (staticUrl) {
            capaImgEl.src = staticUrl;
            capaImgEl.classList.add('visivel');
        }

        tocarCapaPadrao(staticUrl, videoUrl);

        // Painel capa cheia
        atualizarPainelCapaCheia(dadosMusicaAtual);

        // Cor dominante
        if (data.dominant_color) {
            const { r, g, b } = data.dominant_color;
            const fator = 0.5;
            const rF = Math.round(r * fator);
            const gF = Math.round(g * fator);
            const bF = Math.round(b * fator);

            telaEl.style.backgroundColor = `rgb(${rF}, ${gF}, ${bF})`;

            document.documentElement.style.setProperty('--cor-r', rF);
            document.documentElement.style.setProperty('--cor-g', gF);
            document.documentElement.style.setProperty('--cor-b', bF);

            if (painelCapaCheiaEl) {
                painelCapaCheiaEl.style.backgroundColor = `rgb(${rF}, ${gF}, ${bF})`;
            }
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

opcaoVisual.addEventListener('click', (e) => {
    e.stopPropagation();
    assistiveEl.classList.remove('aberto');
    const novo = visualAtual === 'padrao' ? 'capa-cheia' : 'padrao';
    aplicarVisual(novo);
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

// ============================================
// INICIALIZAÇÃO
// ============================================
carregarVisualSalvo();

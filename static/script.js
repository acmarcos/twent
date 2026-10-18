const capaImgEl = document.getElementById('capa-img');
const capaPrincipalVideoEl = document.getElementById('capa-principal-video');
const capaPrincipalImgEl = document.getElementById('capa-principal-img');
const painelEl = document.getElementById('painel');
const usuarioStatusEl = document.getElementById('usuario-status');
const musicaEl = document.getElementById('musica');
const artistaEl = document.getElementById('artista');
const telaEl = document.getElementById('tela');

const assistiveEl = document.getElementById('assistive');
const opcaoPesquisar = document.getElementById('opcao-pesquisar');
const opcaoLetras = document.getElementById('opcao-letras');
const opcaoUltimo = document.getElementById('opcao-ultimo');

const modalPesquisa = document.getElementById('modal-pesquisa');
const inputBusca = document.getElementById('input-busca');
const btnPesquisarConfirmar = document.getElementById('btn-pesquisar-confirmar');

const letrasContainer = document.getElementById('letras-container');
const letraScrollEl = document.getElementById('letra-scroll');

const IS_LOCAL = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
const SERVER_URL = IS_LOCAL ? 'http://127.0.0.1:5000' : window.location.origin;
const STORAGE_KEY = 'twent_ultimo_usuario';

let intervaloAtualizacao = null;
let ultimaMusica = null;
let ultimaAtualizacao = 0;
let usuarioAtual = null;
let hlsInstance = null;

let letrasAtivadas = false;
let musicaAtualAssinatura = ''; 

function calcularLuminancia(r, g, b) {
    const canais = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

// ============================================
// VÍDEO E HLS
// ============================================
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
    capaPrincipalVideoEl.addEventListener('pause', () => capaPrincipalVideoEl.play().catch(() => {}));
}

function limparLoopCrossfade(videoEl) {
    if (!videoEl || !videoEl._crossfade) return;
    const cf = videoEl._crossfade;
    if (cf.intervalo) { clearInterval(cf.intervalo); cf.intervalo = null; }
    if (cf.clone) {
        if (cf.clone._hls) { cf.clone._hls.destroy(); cf.clone._hls = null; }
        cf.clone.remove();
        cf.clone = null;
    }
    videoEl.loop = true;
    videoEl._crossfade = null;
}

function configurarLoopCrossfade(videoEl, urlOriginal) {
    if (!videoEl || !urlOriginal) return;
    limparLoopCrossfade(videoEl);
    videoEl.loop = true;
    const clone = document.createElement('video');
    clone.autoplay = false;
    clone.loop = false;
    clone.muted = true;
    clone.playsInline = true;
    clone.setAttribute('playsinline', '');
    clone.style.position = 'absolute';
    clone.style.top = '0';
    clone.style.left = '0';
    clone.style.width = '100%';
    clone.style.height = '100%';
    clone.style.objectFit = 'cover';
    clone.style.borderRadius = 'inherit';
    clone.style.opacity = '0';
    clone.style.zIndex = '0';
    clone.style.pointerEvents = 'none';
    clone.style.transition = 'opacity 0.2s ease';

    videoEl.parentNode.appendChild(clone);

    let hlsClone = null;
    if (window.Hls && window.Hls.isSupported()) {
        hlsClone = new window.Hls({ enableWorker: true });
        hlsClone.loadSource(urlOriginal);
        hlsClone.attachMedia(clone);
        clone._hls = hlsClone;
    } else {
        clone.src = urlOriginal;
        clone.load();
    }

    let trocando = false;
    const intervalo = setInterval(() => {
        if (!videoEl.duration || trocando) return;
        const restante = videoEl.duration - videoEl.currentTime;
        if (restante <= 0.5) {
            trocando = true;
            try { clone.currentTime = 0; } catch (e) {}
            clone.play().catch(() => {});
            clone.style.zIndex = '2';
            clone.style.opacity = '1';
            setTimeout(() => {
                clone.style.opacity = '0';
                setTimeout(() => {
                    clone.style.zIndex = '0';
                    trocando = false;
                }, 200);
            }, 300);
        }
    }, 50);
    videoEl._crossfade = { clone, hlsClone, intervalo };
}

function tocarHLS(videoEl, url, onHlsInstance) {
    if (!videoEl) return;
    limparLoopCrossfade(videoEl);
    const anterior = onHlsInstance ? onHlsInstance() : null;
    if (anterior) anterior.destroy();
    videoEl.style.display = 'block';
    videoEl.style.opacity = '1';
    bloquearControlesVideo(videoEl);
    videoEl.loop = true;

    if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = url;
        videoEl.play().catch(() => {});
        setTimeout(() => configurarLoopCrossfade(videoEl, url), 800);
        return null;
    }

    if (window.Hls && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(videoEl);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
            videoEl.play().catch(() => {});
            setTimeout(() => configurarLoopCrossfade(videoEl, url), 800);
        });
        return hls;
    }

    videoEl.src = url;
    videoEl.play().catch(() => {});
    setTimeout(() => configurarLoopCrossfade(videoEl, url), 800);
    return null;
}

function tocarCapaPadrao(staticUrl, videoUrl) {
    if (staticUrl) capaPrincipalImgEl.src = staticUrl;
    if (videoUrl) {
        capaPrincipalImgEl.style.display = 'none';
        hlsInstance = tocarHLS(capaPrincipalVideoEl, videoUrl, () => hlsInstance);
    } else if (staticUrl) {
        capaPrincipalVideoEl.style.display = 'none';
        capaPrincipalVideoEl.pause();
        limparLoopCrossfade(capaPrincipalVideoEl);
        capaPrincipalImgEl.style.display = 'block';
    }
}

// ============================================
// BUSCAR LETRA (ESTÁTICA)
// ============================================
async function buscarLetraEstatica(artist, track, album) {
    if (!letraScrollEl) return;
    letraScrollEl.innerHTML = '<div class="linha-letra"><span class="texto-letra">Buscando letra...</span></div>';
    
    try {
        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}&album_name=${encodeURIComponent(album || '')}`;
        const resp = await fetch(url);
        const data = await resp.json();
        
        let letraCompleta = '';
        if (data.plainLyrics) {
            letraCompleta = data.plainLyrics;
        } else if (data.syncedLyrics) {
            letraCompleta = data.syncedLyrics.replace(/\[\d+:\d+\.\d+\]/g, '').trim();
        }

        if (letraCompleta) {
            letraScrollEl.innerHTML = ''; 
            const linhas = letraCompleta.split('\n');
            
            linhas.forEach(linha => {
                if (linha.trim()) {
                    const div = document.createElement('div');
                    div.className = 'linha-letra';
                    const textoSpan = document.createElement('span');
                    textoSpan.className = 'texto-letra';
                    textoSpan.innerHTML = linha.trim().replace(/\n/g, '<br>'); 
                    div.appendChild(textoSpan);
                    letraScrollEl.appendChild(div);
                }
            });
            atualizarLinhaAtiva();
        } else {
            letraScrollEl.innerHTML = '<div class="linha-letra"><span class="texto-letra">Letra não encontrada.</span></div>';
        }
    } catch (e) {
        letraScrollEl.innerHTML = '<div class="linha-letra"><span class="texto-letra">Erro ao carregar a letra.</span></div>';
    }
}

// ============================================
// EFEITO DE FOCO (MARCA A LINHA CENTRAL)
// ============================================
function atualizarLinhaAtiva() {
    if (!letraScrollEl) return;
    const containerRect = letraScrollEl.getBoundingClientRect();
    const centroY = containerRect.top + containerRect.height / 2;
    
    const linhas = letraScrollEl.querySelectorAll('.linha-letra');
    let linhaMaisProxima = null;
    let menorDistancia = Infinity;
    
    linhas.forEach(linha => {
        const linhaRect = linha.getBoundingClientRect();
        const linhaCentro = linhaRect.top + linhaRect.height / 2;
        const distancia = Math.abs(linhaCentro - centroY);
        
        if (distancia < menorDistancia) {
            menorDistancia = distancia;
            linhaMaisProxima = linha;
        }
    });
    
    if (linhaMaisProxima) {
        linhas.forEach(l => l.classList.remove('ativa'));
        linhaMaisProxima.classList.add('ativa');
    }
}

if (letraScrollEl) {
    letraScrollEl.addEventListener('scroll', () => {
        atualizarLinhaAtiva();
    });
}

// ============================================
// LAST.FM
// ============================================
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

        // Se mudou a música
        if (assinaturaAtual !== musicaAtualAssinatura) {
            musicaAtualAssinatura = assinaturaAtual;
            
            if (letrasAtivadas) {
                await buscarLetraEstatica(data.artist, data.track, data.album);
            }
        }

        ultimaMusica = assinaturaAtual;
        ultimaAtualizacao = agora;

        painelEl.classList.add('visivel');
        usuarioStatusEl.textContent = user;
        musicaEl.textContent = data.track;
        artistaEl.textContent = data.artist;

        if (data.static_url) {
            capaImgEl.src = data.static_url;
            capaImgEl.classList.add('visivel');
        }

        tocarCapaPadrao(data.static_url, data.video_url);

        if (data.dominant_color) {
            let { r, g, b } = data.dominant_color;
            const lum = calcularLuminancia(r, g, b);
            if (lum > 0.5) { r = Math.round(r * 0.6); g = Math.round(g * 0.6); b = Math.round(b * 0.6); }
            telaEl.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
            document.documentElement.style.setProperty('--cor-r', r);
            document.documentElement.style.setProperty('--cor-g', g);
            document.documentElement.style.setProperty('--cor-b', b);
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

// ============================================
// EVENTOS
// ============================================
if (opcaoPesquisar) {
    opcaoPesquisar.addEventListener('click', (e) => {
        e.stopPropagation();
        modalPesquisa.classList.add('ativo');
        inputBusca.focus();
    });
}

if (opcaoLetras) {
    opcaoLetras.addEventListener('click', async (e) => {
        e.stopPropagation();
        letrasAtivadas = !letrasAtivadas;
        
        if (letrasAtivadas) {
            letrasContainer.style.display = 'flex';
            if (musicaAtualAssinatura) {
                const [artist, track, album] = musicaAtualAssinatura.split('::');
                await buscarLetraEstatica(artist, track, album);
            }
        } else {
            letrasContainer.style.display = 'none';
        }
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

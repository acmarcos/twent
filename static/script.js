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
const opcaoFavoritar = document.getElementById('opcao-favoritar');
const opcaoPrevia = document.getElementById('opcao-previa');
const opcaoRecomendacoes = document.getElementById('opcao-recomendacoes');

const modalPesquisa = document.getElementById('modal-pesquisa');
const inputBusca = document.getElementById('input-busca');
const btnPesquisarConfirmar = document.getElementById('btn-pesquisar-confirmar');

const modalRecomendacoes = document.getElementById('modal-recomendacoes');
const modalRecomendacoesLista = document.getElementById('modal-recomendacoes-lista');
const audioPrevia = document.getElementById('audio-previa');
const loadingPrevia = document.getElementById('loading-previa');

const letraSincronizadaContainer = document.getElementById('letra-sincronizada-container');
const letraSincronizadaScroll = document.getElementById('letra-sincronizada-scroll');

const assistiveEl = document.getElementById('assistive');

const IS_LOCAL = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
const SERVER_URL = IS_LOCAL ? 'http://127.0.0.1:5000' : window.location.origin;
const STORAGE_KEY = 'twent_ultimo_usuario';
const FAVORITOS_KEY = 'twent_favoritos';

let intervaloAtualizacao = null;
let ultimaMusica = null;
let ultimaAtualizacao = 0;
let usuarioAtual = null;
let hlsInstance = null;

let urlVideoAtual = null;
let videoEstaTocando = false;
let frameCapturado = false;
let loopTimer = null;

let assistenteVisivel = true;
let musicaAtual = null;

let previaTocando = false;
let musicaDaPrevia = null;

let letraSincronizada = [];
let indiceLetraAtual = -1;
let intervaloSincronia = null;

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

function carregarFavoritos() {
    try {
        return JSON.parse(localStorage.getItem(FAVORITOS_KEY)) || [];
    } catch { return []; }
}

function salvarFavoritos(lista) {
    localStorage.setItem(FAVORITOS_KEY, JSON.stringify(lista));
}

function atualizarBotaoFavorito() {
    if (!musicaAtual || !opcaoFavoritar) return;
    const favoritos = carregarFavoritos();
    const chave = `${musicaAtual.artist}::${musicaAtual.track}`;
    const index = favoritos.indexOf(chave);

    if (index !== -1) {
        opcaoFavoritar.classList.add('favoritado');
        opcaoFavoritar.innerHTML = '<i class="fa-solid fa-heart"></i>';
    } else {
        opcaoFavoritar.classList.remove('favoritado');
        opcaoFavoritar.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
}

async function buscarLetraSincronizada(artist, track) {
    try {
        const url = `${SERVER_URL}/api/letra-sincronizada?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(track)}`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.syncedLyrics) {
            const linhas = data.syncedLyrics.split('\n');
            letraSincronizada = [];

            linhas.forEach(linha => {
                const match = linha.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
                if (match) {
                    const minutos = parseInt(match[1]);
                    const segundos = parseInt(match[2]);
                    const centesimos = parseInt(match[3]);
                    const tempo = minutos * 60 + segundos + centesimos / 100;
                    const texto = match[4].trim();
                    if (texto) {
                        letraSincronizada.push({ tempo, texto });
                    }
                }
            });

            return letraSincronizada.length > 0;
        }
    } catch (e) {
        console.error('Erro ao buscar letra sincronizada:', e);
    }
    return false;
}

function renderizarLetraSincronizada() {
    if (!letraSincronizadaScroll) return;
    letraSincronizadaScroll.innerHTML = '';

    if (letraSincronizada.length === 0) {
        letraSincronizadaScroll.innerHTML = '<div class="linha-sincronizada">Letra não encontrada.</div>';
        return;
    }

    letraSincronizada.forEach((linha, index) => {
        const div = document.createElement('div');
        div.className = 'linha-sincronizada';
        div.id = `linha-sinc-${index}`;
        div.textContent = linha.texto;
        letraSincronizadaScroll.appendChild(div);
    });
}

function iniciarSincroniaLetra(startTimeOffset = 0) {
    if (intervaloSincronia) clearInterval(intervaloSincronia);
    indiceLetraAtual = -1;

    const aguardarAudio = setInterval(() => {
        if (audioPrevia.readyState >= 2) {
            clearInterval(aguardarAudio);
            
            intervaloSincronia = setInterval(() => {
                if (!audioPrevia || audioPrevia.paused) return;

                const tempoAtual = audioPrevia.currentTime + startTimeOffset;
                let novoIndice = -1;

                for (let i = 0; i < letraSincronizada.length; i++) {
                    if (tempoAtual >= letraSincronizada[i].tempo) {
                        novoIndice = i;
                    } else {
                        break;
                    }
                }

                if (novoIndice !== indiceLetraAtual && novoIndice >= 0) {
                    indiceLetraAtual = novoIndice;

                    const linhas = letraSincronizadaScroll.querySelectorAll('.linha-sincronizada');
                    linhas.forEach(l => l.classList.remove('ativa'));

                    const linhaAtiva = document.getElementById(`linha-sinc-${novoIndice}`);
                    if (linhaAtiva) {
                        linhaAtiva.classList.add('ativa');
                        linhaAtiva.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }, 50);
        }
    }, 100);
}

function pararSincroniaLetra() {
    if (intervaloSincronia) {
        clearInterval(intervaloSincronia);
        intervaloSincronia = null;
    }
    indiceLetraAtual = -1;
    if (letraSincronizadaScroll) {
        const linhas = letraSincronizadaScroll.querySelectorAll('.linha-sincronizada');
        linhas.forEach(l => l.classList.remove('ativa'));
    }
}

async function tocarPrevia() {
    if (!musicaAtual) return;

    const chaveAtual = `${musicaAtual.artist}::${musicaAtual.track}`;

    if (previaTocando && musicaDaPrevia === chaveAtual) {
        audioPrevia.pause();
        audioPrevia.currentTime = 0;
        previaTocando = false;
        musicaDaPrevia = null;
        opcaoPrevia.innerHTML = '<i class="fa-solid fa-play"></i>';
        pararSincroniaLetra();
        if (letraSincronizadaContainer) letraSincronizadaContainer.style.display = 'none';
        return;
    }

    if (previaTocando) {
        audioPrevia.pause();
        audioPrevia.currentTime = 0;
        previaTocando = false;
        musicaDaPrevia = null;
        pararSincroniaLetra();
    }

    if (loadingPrevia) loadingPrevia.style.display = 'flex';

    try {
        const url = `${SERVER_URL}/api/audio-completo?artist=${encodeURIComponent(musicaAtual.artist)}&track=${encodeURIComponent(musicaAtual.track)}`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.audioUrl) {
            audioPrevia.src = data.audioUrl;
            audioPrevia.load();

            const temLetra = await buscarLetraSincronizada(musicaAtual.artist, musicaAtual.track);

            if (temLetra) {
                letraSincronizadaContainer.style.display = 'block';
                renderizarLetraSincronizada();
            } else {
                letraSincronizadaContainer.style.display = 'none';
            }

            try {
                await audioPrevia.play();
                previaTocando = true;
                musicaDaPrevia = chaveAtual;
                opcaoPrevia.innerHTML = '<i class="fa-solid fa-pause"></i>';

                if (temLetra) {
                    iniciarSincroniaLetra(0);
                }

            } catch (err) {
                console.log('Erro ao tocar áudio:', err);
                previaTocando = false;
                musicaDaPrevia = null;
                opcaoPrevia.innerHTML = '<i class="fa-solid fa-play"></i>';
                alert('Não foi possível tocar o áudio.');
            }

            audioPrevia.onended = () => {
                previaTocando = false;
                musicaDaPrevia = null;
                opcaoPrevia.innerHTML = '<i class="fa-solid fa-play"></i>';
                pararSincroniaLetra();
                if (letraSincronizadaContainer) letraSincronizadaContainer.style.display = 'none';
            };
        } else {
            alert('Áudio não encontrado para esta música.');
        }
    } catch (e) {
        console.error('Erro ao buscar áudio:', e);
        alert('Erro ao buscar áudio.');
    } finally {
        if (loadingPrevia) loadingPrevia.style.display = 'none';
    }
}

async function abrirRecomendacoes() {
    if (!musicaAtual || !modalRecomendacoes) return;

    modalRecomendacoes.classList.add('ativo');
    modalRecomendacoesLista.innerHTML = '<div style="color:#fff; padding:20px; text-align:center;">Carregando...</div>';

    try {
        const resp = await fetch(`${SERVER_URL}/api/recomendacoes?artist=${encodeURIComponent(musicaAtual.artist)}`);
        const data = await resp.json();

        modalRecomendacoesLista.innerHTML = '';

        if (data.length === 0) {
            modalRecomendacoesLista.innerHTML = '<div style="color:#fff; padding:20px; text-align:center;">Nenhuma recomendação encontrada.</div>';
        } else {
            data.forEach(item => {
                const link = document.createElement('a');
                link.className = 'recomendacao-item';
                link.href = `https://music.youtube.com/search?q=${encodeURIComponent(item.trackName + ' ' + item.artistName)}`;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';

                const capaWrapper = document.createElement('div');
                capaWrapper.className = 'recomendacao-capa';

                const img = document.createElement('img');
                img.src = item.artworkUrl100.replace('100x100', '300x300');
                img.alt = item.trackName;

                const overlay = document.createElement('div');
                overlay.className = 'overlay';

                capaWrapper.appendChild(img);
                capaWrapper.appendChild(overlay);

                const info = document.createElement('div');
                info.className = 'recomendacao-info';

                const titulo = document.createElement('span');
                titulo.className = 'recomendacao-titulo';
                titulo.textContent = item.trackName;

                const artista = document.createElement('span');
                artista.className = 'recomendacao-artista';
                artista.textContent = item.artistName;

                info.appendChild(titulo);
                info.appendChild(artista);

                link.appendChild(capaWrapper);
                link.appendChild(info);
                modalRecomendacoesLista.appendChild(link);
            });
        }

        const botaoFecharWrapper = document.createElement('div');
        botaoFecharWrapper.className = 'botao-fechar-recomendacoes';

        const botaoFechar = document.createElement('button');
        botaoFechar.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        botaoFechar.setAttribute('aria-label', 'Fechar recomendações');

        botaoFechar.addEventListener('click', () => {
            modalRecomendacoes.classList.remove('ativo');
        });

        botaoFecharWrapper.appendChild(botaoFechar);
        modalRecomendacoesLista.appendChild(botaoFecharWrapper);

    } catch (e) {
        console.error('Erro ao carregar recomendações:', e);
        modalRecomendacoesLista.innerHTML = '<div style="color:#fff; padding:20px; text-align:center;">Erro ao carregar recomendações.</div>';
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
        
        if (assinaturaAtual !== ultimaMusica || forcar) {
            const chaveNova = `${data.artist}::${data.track}`;
            if (previaTocando && musicaDaPrevia !== chaveNova) {
                audioPrevia.pause();
                audioPrevia.currentTime = 0;
                previaTocando = false;
                musicaDaPrevia = null;
                opcaoPrevia.innerHTML = '<i class="fa-solid fa-play"></i>';
                pararSincroniaLetra();
                if (letraSincronizadaContainer) letraSincronizadaContainer.style.display = 'none';
            }

            ultimaMusica = assinaturaAtual;
            ultimaAtualizacao = agora;

            musicaAtual = { artist: data.artist, track: data.track, album: data.album };

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

            atualizarBotaoFavorito();

            assistiveEl.classList.add('oculto');
            assistenteVisivel = false;

            if (data.dominant_color) {
                let { r, g, b } = data.dominant_color;
                const lum = calcularLuminancia(r, g, b);
                if (lum > 0.5) { r = Math.round(r * 0.6); g = Math.round(g * 0.6); b = Math.round(b * 0.6); }
                telaEl.style.backgroundColor = `rgb(${r}, ${g}, ${b})`;
            }
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
    if (previaTocando) {
        audioPrevia.pause();
        audioPrevia.currentTime = 0;
        previaTocando = false;
        musicaDaPrevia = null;
        opcaoPrevia.innerHTML = '<i class="fa-solid fa-play"></i>';
        pararSincroniaLetra();
        if (letraSincronizadaContainer) letraSincronizadaContainer.style.display = 'none';
    }
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

if (opcaoFavoritar) {
    opcaoFavoritar.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!musicaAtual) return;

        const favoritos = carregarFavoritos();
        const chave = `${musicaAtual.artist}::${musicaAtual.track}`;
        const index = favoritos.indexOf(chave);

        if (index !== -1) {
            favoritos.splice(index, 1);
        } else {
            favoritos.push(chave);
        }

        salvarFavoritos(favoritos);
        atualizarBotaoFavorito();
    });
}

if (opcaoPrevia) {
    opcaoPrevia.addEventListener('click', (e) => {
        e.stopPropagation();
        tocarPrevia();
    });
}

if (opcaoRecomendacoes) {
    opcaoRecomendacoes.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirRecomendacoes();
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

document.addEventListener('click', (e) => {
    if (assistiveEl.contains(e.target) || modalRecomendacoes.contains(e.target) || modalPesquisa.contains(e.target)) {
        return;
    }
    
    if (!assistenteVisivel) {
        assistiveEl.classList.remove('oculto');
        assistenteVisivel = true;
    }
}, { passive: true });

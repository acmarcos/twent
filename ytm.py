import os
import json
import time
import re
import requests
from ytmusicapi import YTMusic

# ============================================
# CONFIGURAÇÃO
# ============================================
ARITRA_API = "https://api.aritra.ovh/v1"
ARQUIVO_SAIDA = "capas_animadas_playlist.json"
ARQUIVO_CACHE = "cache_playlist.json"
DELAY_ENTRE_REQUISICOES = 0.5  # segundos entre cada verificação

# ============================================
# CACHE (evita verificar a mesma música 2x)
# ============================================
def carregar_cache():
    if os.path.exists(ARQUIVO_CACHE):
        try:
            with open(ARQUIVO_CACHE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def salvar_cache(cache):
    with open(ARQUIVO_CACHE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

# ============================================
# PEGA A PLAYLIST DO YOUTUBE MUSIC
# ============================================
def extrair_id_playlist(url):
    """Extrai o ID da playlist de uma URL do YouTube Music."""
    match = re.search(r'[?&]list=([a-zA-Z0-9_-]+)', url)
    if match:
        return match.group(1)
    return url.strip()

def pegar_playlist(url):
    """Usa ytmusicapi pra pegar os metadados da playlist."""
    playlist_id = extrair_id_playlist(url)
    print(f"ID da playlist: {playlist_id}")

    yt = YTMusic()
    print("Buscando playlist...")
    playlist = yt.get_playlist(playlist_id, limit=None)

    nome = playlist.get('title', 'Sem nome')
    tracks = playlist.get('tracks', [])
    print(f"Playlist: {nome}")
    print(f"Músicas encontradas: {len(tracks)}")
    print()

    musicas = []
    for t in tracks:
        artistas = ", ".join([a['name'] for a in t.get('artists', [])])
        album_obj = t.get('album')
        album = album_obj.get('name', '') if album_obj else ''
        musicas.append({
            "track": t.get('title', ''),
            "artist": artistas,
            "album": album,
            "videoId": t.get('videoId', '')
        })

    return musicas

# ============================================
# VERIFICA CAPA ANIMADA NO APPLE MUSIC
# ============================================
def buscar_url_apple_music(artist, album):
    """Busca a URL do álbum no Apple Music via iTunes Search."""
    try:
        itunes_url = "https://itunes.apple.com/search"
        params = {
            "term": f"{artist} {album}",
            "media": "music",
            "entity": "album",
            "limit": 1
        }
        resp = requests.get(itunes_url, params=params, timeout=10)
        data = resp.json()
        if data.get("resultCount", 0) > 0:
            return data["results"][0].get("collectionViewUrl", "")
    except Exception as e:
        print(f"  Erro no iTunes: {e}")
    return None

def extrair_variante_hls(hls_url, resolucao_desejada=None):
    """Baixa o manifesto HLS e extrai a URL da melhor variante."""
    try:
        resp = requests.get(hls_url, timeout=10)
        if resp.status_code != 200:
            return None

        linhas = resp.text.split('\n')
        base_url = hls_url.rsplit('/', 1)[0]

        variantes = []
        for i, linha in enumerate(linhas):
            linha = linha.strip()
            if linha.startswith('#EXT-X-STREAM-INF') and 'RESOLUTION=' in linha:
                m = re.search(r'RESOLUTION=(\d+)x(\d+)', linha)
                if m and i + 1 < len(linhas):
                    proxima = linhas[i + 1].strip()
                    if proxima and not proxima.startswith('#'):
                        url = proxima if proxima.startswith('http') else f"{base_url}/{proxima}"
                        variantes.append((int(m.group(1)), url))

        if not variantes:
            return None

        if resolucao_desejada:
            alvo = int(resolucao_desejada.split('x')[0])
            iguais = [v for v in variantes if v[0] == alvo]
            if iguais:
                return iguais[0][1]

        variantes.sort(key=lambda x: x[0], reverse=True)
        return variantes[0][1]
    except Exception:
        return None

def verificar_capa_animada(artist, album):
    """Retorna info da capa animada ou None."""
    apple_url = buscar_url_apple_music(artist, album)
    if not apple_url:
        return None

    try:
        resp = requests.get(f"{ARITRA_API}/covers", params={"url": apple_url}, timeout=15)
        if resp.status_code != 200:
            return None

        data = resp.json()
        master = data.get("master", {})
        hls_url = master.get("square") or master.get("tall")
        if not hls_url:
            return None

        video_url = extrair_variante_hls(hls_url, "1080x1080")
        resolucao = "1080x1080"
        if not video_url:
            video_url = extrair_variante_hls(hls_url, "720x720")
            resolucao = "720x720"
        if not video_url:
            video_url = extrair_variante_hls(hls_url, "540x540")
            resolucao = "540x540"
        if not video_url:
            video_url = extrair_variante_hls(hls_url)
            resolucao = "outra"

        if video_url:
            return {
                "hls_master": hls_url,
                "video_url": video_url,
                "resolucao": resolucao,
                "apple_music_url": apple_url
            }
    except Exception as e:
        print(f"  Erro no aritra: {e}")
        return None

    return None

# ============================================
# MAIN
# ============================================
def main():
    print("=" * 55)
    print("  Verificador de Capas Animadas - YouTube Music")
    print("=" * 55)
    print()

    url = input("Cole a URL da playlist: ").strip()
    if not url:
        print("URL vazia. Saindo.")
        return

    # 1. Pega a playlist
    try:
        musicas = pegar_playlist(url)
    except Exception as e:
        print(f"Erro ao buscar a playlist: {e}")
        return

    if not musicas:
        print("Nenhuma música encontrada na playlist.")
        return

    # 2. Cache
    cache = carregar_cache()
    print(f"Cache: {len(cache)} músicas já verificadas.")
    print()

    # 3. Verifica cada música
    resultado = []
    total = len(musicas)

    for i, m in enumerate(musicas, 1):
        artist = m["artist"]
        track = m["track"]
        album = m["album"]
        chave = f"{artist}::{track}".lower()

        # Se já está no cache
        if chave in cache:
            entrada = cache[chave]
            if entrada.get("tem_capa"):
                print(f"[{i}/{total}] ✓ (cache) {artist} - {track}")
                resultado.append({
                    "artist": artist,
                    "track": track,
                    "album": album,
                    **entrada.get("info", {})
                })
            else:
                print(f"[{i}/{total}] ✗ (cache) {artist} - {track}")
            continue

        # Verifica agora
        print(f"[{i}/{total}] Verificando: {artist} - {track}")

        if not artist or not track:
            print("  → Sem artista ou música. Pulando.")
            cache[chave] = {"tem_capa": False, "motivo": "dados_incompletos"}
            time.sleep(DELAY_ENTRE_REQUISICOES)
            continue

        # Se a playlist já trouxe o álbum, usa. Senão, busca no iTunes.
        album_busca = album
        if not album_busca:
            try:
                itunes_url = "https://itunes.apple.com/search"
                params = {
                    "term": f"{artist} {track}",
                    "media": "music",
                    "entity": "song",
                    "limit": 1
                }
                resp = requests.get(itunes_url, params=params, timeout=10)
                data = resp.json()
                if data.get("resultCount", 0) > 0:
                    album_busca = data["results"][0].get("collectionName", "")
            except Exception:
                pass

        if not album_busca:
            print("  → Álbum não encontrado.")
            cache[chave] = {"tem_capa": False, "motivo": "sem_album"}
            time.sleep(DELAY_ENTRE_REQUISICOES)
            continue

        info = verificar_capa_animada(artist, album_busca)
        if info:
            print(f"  → ✓ TEM CAPA ANIMADA ({info['resolucao']})")
            cache[chave] = {
                "tem_capa": True,
                "info": info
            }
            resultado.append({
                "artist": artist,
                "track": track,
                "album": album_busca,
                **info
            })
        else:
            print(f"  → ✗ Sem capa animada")
            cache[chave] = {"tem_capa": False}

        # Salva cache a cada 10
        if i % 10 == 0:
            salvar_cache(cache)

        time.sleep(DELAY_ENTRE_REQUISICOES)

    salvar_cache(cache)

    # 4. Salva o resultado
    with open(ARQUIVO_SAIDA, 'w', encoding='utf-8') as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)

    print()
    print("=" * 55)
    print("  RESULTADO")
    print("=" * 55)
    print(f"Total de músicas: {total}")
    print(f"Com capa animada: {len(resultado)}")
    print(f"Arquivo salvo: {ARQUIVO_SAIDA}")
    print()

    # Mostra um resumo das que têm capa
    if resultado:
        print("Músicas com capa animada:")
        for r in resultado:
            print(f"  ✓ {r['artist']} - {r['track']} ({r['resolucao']})")

if __name__ == "__main__":
    main()

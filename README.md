# PANDAS FC — Firebase sincronizado

Esta versão usa o **Cloud Firestore** do projeto `panda-fc-449f7`.

## O que sincroniza

- jogadores;
- elenco;
- escalação selecionada;
- agenda;
- placares;
- estatísticas (calculadas a partir dos placares);
- artilharia;
- logo do PANDAS FC;
- logos dos adversários.

As alterações aparecem automaticamente nos outros dispositivos conectados.

## Publicação no GitHub Pages

Em **Settings → Pages**:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/(root)**

Substitua os arquivos antigos pelos arquivos deste ZIP e faça o commit.

## Dados antigos

Se você já tinha jogadores ou partidas salvos na versão anterior, abra:
**Configurações → Importar dados antigos deste dispositivo**.

Faça isso apenas em um dispositivo para evitar duplicações.

## Firestore

Enquanto o Firestore estiver em modo de teste, o aplicativo consegue ler e gravar sem login. O modo de teste expira conforme a regra criada pelo Firebase. Antes de expirar, será necessário atualizar a regra caso você queira continuar sem autenticação.

## Cache

O service worker desta versão usa o cache `pandas-fc-v5-firebase`. Depois de publicar, use `Ctrl + F5` no computador ou feche/reabra o app no Android.


## Cabeçalho
Esta versão inclui a arte `header-pandas-fc.png` como cabeçalho responsivo do site e do PWA.

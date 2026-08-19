# PANDAS FC

Aplicação do PANDAS FC para Web e Android, criada com React + Vite + Capacitor.

## Funcionalidades incluídas

- Dashboard com a logo do time.
- Cadastro de jogadores: nome, posição e número.
- Elenco com pesquisa.
- Escalação visual em campo e exportação da escalação em PNG.
- Agenda de confrontos PANDAS FC x adversário, com logo, data, hora e local.
- Geração de arte de divulgação da partida em PNG.
- Lembrete local no Android no horário da partida.
- Partidas com placar e status automático: vitória, derrota ou empate.
- Estatísticas automáticas do time.
- Artilharia com ranking e soma de gols.
- Configurações para logo e nome do time.
- Dados salvos localmente no aparelho/navegador.

## Rodar no navegador

Requer Node.js 22+.

```bash
npm install
npm run dev
```

Depois abra o endereço mostrado pelo Vite.

## Gerar a versão Android

Na primeira vez:

```bash
npm install
npm run build
npm run android:add
npm run android:sync
npm run android:open
```

O último comando abre o projeto Android no Android Studio. Depois use **Run** para testar ou **Build > Generate Signed App Bundle / APK** para gerar o aplicativo.

Nas próximas alterações:

```bash
npm run android:sync
npm run android:open
```

## Notificações Android

A aplicação usa `@capacitor/local-notifications`. Ao criar uma partida futura na Agenda, o app tenta agendar um lembrete no horário do confronto. Em Android 13+ o usuário precisa autorizar notificações.

## GitHub

Crie um repositório, copie os arquivos desta pasta e execute:

```bash
git init
git add .
git commit -m "Primeira versão do PANDAS FC"
git branch -M main
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
```

## Próximas melhorias recomendadas

- Login e banco de dados online para sincronizar celulares e computadores.
- Cadastro de gols diretamente dentro de cada partida para alimentar automaticamente a artilharia.
- Edição/exclusão completa de partidas.
- Formação tática configurável (4-3-3, 4-4-2 etc.).
- Personalização das artes geradas.
- Publicação como PWA e na Google Play.

## Publicar no GitHub Pages

Este projeto já vem preparado para o repositório **PandasFc** e para o endereço:

`https://abimaeltvrs.github.io/PandasFc/`

1. Envie todos os arquivos para a branch `main`, incluindo a pasta `.github/workflows`.
2. No GitHub, abra **Settings > Pages**.
3. Em **Build and deployment > Source**, selecione **GitHub Actions**.
4. Abra a aba **Actions** e aguarde o workflow **Deploy PANDAS FC to GitHub Pages** concluir.
5. Acesse o endereço acima e, se necessário, atualize a página com `Ctrl + F5`.

O comando usado pelo GitHub é `npm run build:github`, que configura automaticamente o caminho `/PandasFc/`. O build normal (`npm run build`) continua usando caminhos relativos para manter compatibilidade com o Capacitor/Android.

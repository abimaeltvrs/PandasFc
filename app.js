let deferredPrompt;
const installBtn = document.getElementById('installBtn');
const installHint = document.getElementById('installHint');

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.hidden = false;
  if (installHint) {
    installHint.textContent = 'Este dispositivo permite instalar o PANDAS FC como aplicativo.';
  }
});

installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) {
    alert('A instalação ainda não está disponível neste navegador. No Android/Chrome, abra o menu do navegador e procure por “Instalar app” ou “Adicionar à tela inicial”.');
    return;
  }

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;

  if (outcome === 'accepted') {
    installBtn.hidden = true;
  }

  deferredPrompt = null;
});

window.addEventListener('appinstalled', () => {
  installBtn.hidden = true;
  if (installHint) {
    installHint.textContent = 'PANDAS FC instalado com sucesso.';
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js');
  });
}

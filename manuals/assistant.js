const question = document.getElementById('question');
const status = document.getElementById('status');
const connection = document.getElementById('connection');
const continueLink = document.getElementById('continue-gpt');
const send = document.getElementById('send-question');
function updateConnection() {
  connection.textContent = navigator.onLine ? 'Online' : 'Offline';
  connection.classList.toggle('offline', !navigator.onLine);
  if (!navigator.onLine) status.textContent = 'Per continuare serve una connessione Internet.';
}
function updateInput() { send.disabled = !question.value.trim(); }
question.addEventListener('input', updateInput);
document.getElementById('question-form').addEventListener('submit', async event => {
  event.preventDefault();
  const message = question.value.trim();
  if (!message) return;
  if (!navigator.onLine) { updateConnection(); return; }
  // Open during the user gesture; clipboard completion may outlive popup permission.
  window.open(continueLink.href, '_blank', 'noopener,noreferrer');
  continueLink.hidden = false;
  try {
    await navigator.clipboard.writeText(message);
    status.textContent = 'Domanda copiata. Incollala nella chat del GPT.';
  } catch {
    status.textContent = 'Copia il messaggio e incollalo nella chat del GPT.';
    question.focus();
    question.select();
  }
});
addEventListener('online', () => { status.textContent = ''; updateConnection(); });
addEventListener('offline', updateConnection);
updateConnection();
updateInput();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).catch(() => {});

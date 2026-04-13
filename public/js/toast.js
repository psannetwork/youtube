/**
 * トースト通知管理
 */

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

function showConfirm(message) {
  return new Promise((resolve) => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast toast-info';
    toast.style.flexDirection = 'column';
    toast.style.gap = '12px';
    toast.style.alignItems = 'stretch';
    toast.innerHTML = `<div>${message}</div><div style="display:flex;gap:8px;justify-content:flex-end;"><button class="btn btn-sm btn-danger confirm-cancel">キャンセル</button><button class="btn btn-sm btn-success confirm-ok">OK</button></div>`;
    container.appendChild(toast);
    toast.querySelector('.confirm-ok').addEventListener('click', () => {
      toast.remove();
      resolve(true);
    });
    toast.querySelector('.confirm-cancel').addEventListener('click', () => {
      toast.remove();
      resolve(false);
    });
  });
}

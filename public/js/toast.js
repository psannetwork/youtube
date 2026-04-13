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

    const msgDiv = document.createElement('div');
    msgDiv.textContent = message;
    toast.appendChild(msgDiv);

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '8px';
    btnContainer.style.justifyContent = 'flex-end';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-sm btn-danger confirm-cancel';
    cancelBtn.textContent = 'キャンセル';
    btnContainer.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-sm btn-success confirm-ok';
    okBtn.textContent = 'OK';
    btnContainer.appendChild(okBtn);

    toast.appendChild(btnContainer);
    container.appendChild(toast);

    okBtn.addEventListener('click', () => {
      toast.remove();
      resolve(true);
    });
    cancelBtn.addEventListener('click', () => {
      toast.remove();
      resolve(false);
    });
  });
}

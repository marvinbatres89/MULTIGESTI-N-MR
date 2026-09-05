(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const cloud = () => window.MGCloud;

  function toast(message) {
    const t = $('toast');
    if (!t) return;
    t.textContent = message;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function setVersionBadge() {
    const pill = $('versionPill');
    if (pill) pill.textContent = 'V1.3.1';
  }

  function openRecoveryDialog() {
    const dialog = $('resetPasswordDialog');
    if (!dialog) return;
    try {
      if (!dialog.open) dialog.showModal();
    } catch (_) {}
  }

  setVersionBadge();
  setTimeout(setVersionBadge, 100);

  $('forgotPasswordBtn')?.addEventListener('click', async () => {
    const email = String($('authEmail')?.value || '').trim();
    if (!email) {
      toast('Escriba primero el correo del administrador');
      $('authEmail')?.focus();
      return;
    }

    try {
      await cloud().resetPasswordForEmail(email);
      toast('Correo de recuperación enviado. Revise su bandeja de entrada.');
    } catch (err) {
      console.error(err);
      toast(err?.message || 'No se pudo enviar el correo de recuperación');
    }
  });

  $('closeResetPasswordDialog')?.addEventListener('click', () => {
    $('resetPasswordDialog')?.close();
  });

  $('resetPasswordForm')?.addEventListener('submit', async event => {
    event.preventDefault();

    const password = $('newPassword')?.value || '';
    const confirmPassword = $('confirmNewPassword')?.value || '';

    if (password.length < 6) {
      toast('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    if (password !== confirmPassword) {
      toast('Las contraseñas no coinciden');
      return;
    }

    try {
      await cloud().updatePassword(password);
      $('resetPasswordForm')?.reset();
      $('resetPasswordDialog')?.close();
      $('authDialog')?.close();
      toast('Contraseña actualizada. Ya puede iniciar sesión con la nueva contraseña.');
    } catch (err) {
      console.error(err);
      toast(err?.message || 'No se pudo actualizar la contraseña');
    }
  });

  window.addEventListener('mg-password-recovery', openRecoveryDialog);

  if (cloud()?.state?.recoveryMode) {
    setTimeout(openRecoveryDialog, 0);
  }
})();

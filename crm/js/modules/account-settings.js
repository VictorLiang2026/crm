// Account actions stay on the existing CloudBase auth session; CRM business data is untouched.
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function passwordField(label, name, autocomplete) {
  const field = node('div', 'field');
  const caption = node('label', '', label);
  const input = node('input');
  input.type = 'password';
  input.name = name;
  input.autocomplete = autocomplete;
  caption.htmlFor = name;
  input.id = name;
  field.append(caption, input);
  return { field, input };
}

export function renderAccountSettings({ root, changePassword, signOut, reloadLatest }) {
  const page = node('section', 'phase14-page');
  page.append(node('h2', '', '账号与应用维护'),
    node('p', 'phase14-intro', '管理当前账号，并在迭代发布后重新加载应用。'));
  const back = node('a', '', '← 更多');
  back.href = '#/more';
  page.append(back);

  const passwordCard = node('section', 'card');
  passwordCard.append(node('h3', '', '修改密码'),
    node('p', 'phase14-muted', '使用当前密码验证；修改成功后需要用新密码重新登录。'));
  const form = node('form');
  form.noValidate = true;
  const oldPassword = passwordField('当前密码', 'account-old-password', 'current-password');
  const newPassword = passwordField('新密码', 'account-new-password', 'new-password');
  const confirmation = passwordField('确认新密码', 'account-confirm-password', 'new-password');
  const submit = node('button', 'btn btn-primary', '修改密码');
  submit.type = 'submit';
  const passwordStatus = node('p', 'phase14-muted');
  passwordStatus.setAttribute('role', 'status');
  form.append(oldPassword.field, newPassword.field, confirmation.field, submit, passwordStatus);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const oldValue = oldPassword.input.value;
    const newValue = newPassword.input.value;
    const confirmValue = confirmation.input.value;
    passwordStatus.className = 'phase14-error';
    if (!oldValue || !newValue || !confirmValue) {
      passwordStatus.textContent = '请填写当前密码、新密码和确认密码。'; return;
    }
    if (newValue.length < 8 || newValue.length > 64) {
      passwordStatus.textContent = '新密码须为 8 至 64 个字符。'; return;
    }
    if (newValue === oldValue) {
      passwordStatus.textContent = '新密码不能与当前密码相同。'; return;
    }
    if (newValue !== confirmValue) {
      passwordStatus.textContent = '两次输入的新密码不一致。'; return;
    }
    submit.disabled = true;
    passwordStatus.className = 'phase14-muted';
    passwordStatus.textContent = '正在修改密码…';
    try {
      await changePassword(oldValue, newValue);
      passwordStatus.textContent = '密码已修改，正在返回登录页…';
    } catch (error) {
      passwordStatus.className = 'phase14-error';
      passwordStatus.textContent = error.message || '修改密码失败，请重试。';
      submit.disabled = false;
    }
  });
  passwordCard.append(form);

  const maintenanceCard = node('section', 'card');
  maintenanceCard.append(node('h3', '', '应用维护'),
    node('p', 'phase14-muted', '发布后完整重新加载页面与静态资源。保留登录状态和本地业务数据。'));
  const reload = node('button', 'btn', '强制加载最新版');
  reload.type = 'button';
  reload.addEventListener('click', () => {
    if (window.confirm('重新加载会丢失当前未保存的输入。确定继续吗？')) reloadLatest();
  });
  maintenanceCard.append(reload);

  const signOutCard = node('section', 'card');
  signOutCard.append(node('h3', '', '退出登录'),
    node('p', 'phase14-muted', '结束当前浏览器中的登录状态，返回登录页面。'));
  const logout = node('button', 'btn btn-danger', '退出登录');
  logout.type = 'button';
  const logoutStatus = node('p', 'phase14-muted');
  logoutStatus.setAttribute('role', 'status');
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    logoutStatus.textContent = '正在退出…';
    try { await signOut(); }
    catch (error) {
      logoutStatus.className = 'phase14-error';
      logoutStatus.textContent = error.message || '退出失败，请重试。';
      logout.disabled = false;
    }
  });
  signOutCard.append(logout, logoutStatus);
  page.append(passwordCard, maintenanceCard, signOutCard);
  root.replaceChildren(page);
}

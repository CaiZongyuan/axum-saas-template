// Core's own bilingual message catalog (docs/ui/design.md §6 Q1): the
// universal shell, home, identity flows and settings register their texts
// here, by owner. Examples namespace their keys by example id at assembly;
// a Core key an example tries to take over fails the assembly. Both
// locales must stay complete — the parity test in core-messages.test.ts is
// the release check.

export const coreMessages: {
  zh: Record<string, string>;
  en: Record<string, string>;
} = {
  zh: {
    'app.name': 'SaaS 模板',
    'app.description': '从真实全栈请求开始的可运行 SaaS 模板教程。',

    'shell.nav.mainMenu': '主菜单',
    'shell.nav.management': '管理',
    'shell.nav.home': '首页',
    'shell.nav.notifications': '通知',
    'shell.nav.members': '企业成员',
    'shell.nav.jobs': '后台任务',
    'shell.nav.audit': '审计记录',
    'shell.nav.settings': '外观与语言',
    'shell.nav.apiKeys': 'API Keys',
    'shell.nav.tutorials': '使用教程',
    'shell.nav.status': '系统状态',
    'shell.nav.openMenu': '打开导航菜单',
    'shell.nav.closeMenu': '关闭导航菜单',
    'shell.nav.skipToContent': '跳到主内容区',

    'common.retry': '重试',
    'common.requestId': '请求编号：{id}',
    'login.docTitle': '登录',
    'common.rateLimitHint': '请求过于频繁，请 {seconds} 秒后重试。',

    'home.loadingSession': '正在读取会话…',
    'home.sessionError': '无法读取会话',
    'home.sessionErrorHint': '请检查网络后重试。',
    'home.greeting': '你好，{name}',
    'home.title': '欢迎使用企业空间',
    'home.signedInHint': '你已登录，可以开始使用企业空间。',
    'home.signedOutHint': '当前没有有效会话，请登录或创建账号。',
    'home.logout': '退出登录',
    'home.loggingOut': '正在退出…',
    'home.logoutError': '退出失败',
    'home.registerAccount': '创建账号',
    'home.role.owner': '企业所有者',
    'home.role.admin': '管理员',
    'home.role.member': '成员',

    'login.title': '登录企业空间',
    'login.description': '使用你的邮箱和密码继续。',
    'login.email': '邮箱',
    'login.password': '密码',
    'login.submit': '登录',
    'login.pending': '正在登录…',
    'login.cooldown': '请等待 {seconds} 秒',
    'login.error.title': '登录未完成',
    'login.error.rateLimitedWait': '请求过于频繁，请等待后重试。',
    'login.error.rateLimitedReady': '请求过于频繁，现在可以重新尝试。',
    'login.error.invalidCredentials': '邮箱或密码不正确，请重新输入。',
    'login.error.generic': '暂时无法登录，请稍后重试。',
    'login.forgotPassword': '忘记密码？',
    'login.createAccount': '还没有账号？创建账号',

    'register.docTitle': '创建账号',
    'register.title': '创建你的账号',
    'register.description': '使用邮箱与密码，进入企业空间。',
    'register.passwordHint': '使用 12–128 个字符，可以包含空格。',
    'register.displayName': '显示名（可选）',
    'register.pending': '正在创建账号…',
    'register.haveAccount': '已有账号？登录',
    'register.error.title': '注册未完成',
    'register.error.emailExists': '这个邮箱已注册，请使用已有账号登录。',
    'register.error.sessionUnavailable':
      '账号已创建，但暂时无法登录。请稍后登录，无需重新注册。',
    'register.error.invalidInput': '请检查邮箱、密码和显示名后重试。',
    'register.error.generic': '暂时无法完成注册，请稍后重试。',

    'forgot.docTitle': '找回密码',
    'forgot.title': '找回密码',
    'forgot.description': '使用注册邮箱申请一次性重置链接。',
    'forgot.sent': '如果该账号可用，你会收到重置邮件。请检查收件箱或垃圾邮件。',
    'forgot.refill': '重新填写邮箱',
    'forgot.submit': '发送重置邮件',
    'forgot.pending': '正在申请…',
    'forgot.backToLogin': '返回登录',

    'reset.docTitle': '重置密码',
    'reset.title': '设置新密码',
    'reset.description': '成功后，原来的登录会话会失效。',
    'reset.done': '密码已重置，请重新登录。',
    'reset.linkIncompleteTitle': '重置链接不完整',
    'reset.linkIncomplete': '请重新打开邮件中的链接，或重新申请。',
    'reset.newPassword': '新密码',
    'reset.confirmPassword': '确认新密码',
    'reset.passwordHint': '使用 12–128 个字符。',
    'reset.mismatch': '两次输入的密码不一致。',
    'reset.submit': '设置新密码',
    'reset.pending': '正在重置…',
    'reset.requestNew': '重新申请链接',
    'reset.error.title': '密码重置未完成',
    'reset.error.invalidLink': '重置链接无效或已失效，请重新申请。',
    'reset.error.invalidInput': '请检查邮箱或 12–128 个字符的新密码。',
    'reset.error.generic':
      '暂时无法确认结果，请稍后重试；也可以尝试用新密码登录。',

    'common.backHome': '返回首页',

    'settings.title': '外观与语言',
    'settings.description':
      '偏好保存在当前设备：登录前后均生效，不跨设备同步。',
    'settings.language': '语言',
    'settings.languageHint': '首次使用跟随设备语言，手动选择优先。',
    'settings.language.zh': '简体中文',
    'settings.language.en': 'English',
    'settings.theme': '主题',
    'settings.themeHint': '「跟随系统」随系统明暗变化；其他选项保持固定。',
    'settings.tutorial': '查看「外观与语言」教程',
    'settings.theme.system': '跟随系统',
    'settings.theme.light': '亮色',
    'settings.theme.dark': '暗色',

    'unavailable.title': '相关功能当前不可用',
    'unavailable.description': '这个地址指向的功能可能已被移除，或从未存在。',
    'unavailable.backHome': '返回首页',
  },
  en: {
    'app.name': 'SaaS Template',
    'app.description':
      'A runnable SaaS template tutorial starting from a real full-stack request.',

    'shell.nav.mainMenu': 'Main menu',
    'shell.nav.management': 'Administration',
    'shell.nav.home': 'Home',
    'shell.nav.notifications': 'Notifications',
    'shell.nav.members': 'Members',
    'shell.nav.jobs': 'Background jobs',
    'shell.nav.audit': 'Audit trail',
    'shell.nav.settings': 'Appearance & language',
    'shell.nav.apiKeys': 'API Keys',
    'shell.nav.tutorials': 'Documentation',
    'shell.nav.status': 'System status',
    'shell.nav.openMenu': 'Open navigation menu',
    'shell.nav.closeMenu': 'Close navigation menu',
    'shell.nav.skipToContent': 'Skip to main content',

    'common.retry': 'Retry',
    'common.requestId': 'Request ID: {id}',
    'login.docTitle': 'Sign in',
    'common.rateLimitHint':
      'Too many requests; try again in {seconds} seconds.',

    'home.loadingSession': 'Loading session…',
    'home.sessionError': 'Could not read the session',
    'home.sessionErrorHint': 'Check your network and try again.',
    'home.greeting': 'Hello, {name}',
    'home.title': 'Welcome to your workspace',
    'home.signedInHint': 'You are signed in and ready to use the workspace.',
    'home.signedOutHint': 'No active session — sign in or create an account.',
    'home.logout': 'Sign out',
    'home.loggingOut': 'Signing out…',
    'home.logoutError': 'Sign-out failed',
    'home.registerAccount': 'Create account',
    'home.role.owner': 'Owner',
    'home.role.admin': 'Admin',
    'home.role.member': 'Member',

    'login.title': 'Sign in to your workspace',
    'login.description': 'Continue with your email and password.',
    'login.email': 'Email',
    'login.password': 'Password',
    'login.submit': 'Sign in',
    'login.pending': 'Signing in…',
    'login.cooldown': 'Please wait {seconds} seconds',
    'login.error.title': 'Sign-in incomplete',
    'login.error.rateLimitedWait':
      'Too many requests — wait a moment and retry.',
    'login.error.rateLimitedReady': 'Too many requests — you can retry now.',
    'login.error.invalidCredentials':
      'Email or password is incorrect; try again.',
    'login.error.generic':
      'Sign-in is temporarily unavailable; try again later.',
    'login.forgotPassword': 'Forgot password?',
    'login.createAccount': 'No account yet? Create one',

    'register.docTitle': 'Create account',
    'register.title': 'Create your account',
    'register.description':
      'Use your email and password to enter the workspace.',
    'register.passwordHint': 'Use 12–128 characters; spaces are allowed.',
    'register.displayName': 'Display name (optional)',
    'register.pending': 'Creating account…',
    'register.haveAccount': 'Already have an account? Sign in',
    'register.error.title': 'Registration incomplete',
    'register.error.emailExists':
      'This email is already registered; sign in instead.',
    'register.error.sessionUnavailable':
      'The account was created, but signing in failed for now. Sign in later — no need to register again.',
    'register.error.invalidInput':
      'Check the email, password and display name, then retry.',
    'register.error.generic':
      'Registration is temporarily unavailable; try again later.',

    'forgot.docTitle': 'Reset password',
    'forgot.title': 'Forgot password',
    'forgot.description':
      'Request a one-time reset link for your account email.',
    'forgot.sent':
      'If the account exists, a reset email is on its way. Check your inbox or spam folder.',
    'forgot.refill': 'Edit the email address',
    'forgot.submit': 'Send reset email',
    'forgot.pending': 'Requesting…',
    'forgot.backToLogin': 'Back to sign-in',

    'reset.docTitle': 'Set a new password',
    'reset.title': 'Set a new password',
    'reset.description': 'When it succeeds, existing sessions stop working.',
    'reset.done': 'Password reset — sign in with the new password.',
    'reset.linkIncompleteTitle': 'The reset link is incomplete',
    'reset.linkIncomplete':
      'Reopen the link from the email, or request a new one.',
    'reset.newPassword': 'New password',
    'reset.confirmPassword': 'Confirm new password',
    'reset.passwordHint': 'Use 12–128 characters.',
    'reset.mismatch': 'The passwords do not match.',
    'reset.submit': 'Set new password',
    'reset.pending': 'Resetting…',
    'reset.requestNew': 'Request a new link',
    'reset.error.title': 'Password reset incomplete',
    'reset.error.invalidLink':
      'The reset link is invalid or expired; request a new one.',
    'reset.error.invalidInput':
      'Check the email or the 12–128 character new password.',
    'reset.error.generic':
      'The result could not be confirmed; try again later, or try signing in with the new password.',

    'common.backHome': 'Back to home',

    'settings.title': 'Appearance & language',
    'settings.description':
      'Preferences stay on this device: they apply before and after sign-in and never sync across devices.',
    'settings.language': 'Language',
    'settings.languageHint':
      'First visit follows the device language; an explicit choice wins.',
    'settings.language.zh': '简体中文',
    'settings.language.en': 'English',
    'settings.theme': 'Theme',
    'settings.themeHint':
      'System keeps following the OS; the other options stay fixed.',
    'settings.tutorial': 'Read the appearance & language tutorial',
    'settings.theme.system': 'System',
    'settings.theme.light': 'Light',
    'settings.theme.dark': 'Dark',

    'unavailable.title': 'This feature is currently unavailable',
    'unavailable.description':
      'The address may point at a removed example, or at a page that never existed.',
    'unavailable.backHome': 'Back to home',
  },
};

window.__ModuleLoader__.load({
  id: '@local/dsh-subscription-agents',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState, useId } = React;
    const NS = 'subscriptionAgents';
    const PANEL = 'subscription-agents';
    const providers = { codex: 'Codex', claude: 'Claude Code' };
    const signInHosts = {
      codex: new Set(['auth.openai.com', 'login.openai.com']),
      claude: new Set(['claude.ai', 'console.anthropic.com', 'platform.claude.com']),
    };
    const ru = {
      panel: 'Агенты по подписке', title: 'Агенты по подписке',
      intro: 'Подключите Codex и Claude Code как полноценных агентов проекта с отдельными дочерними чатами.',
      privacy: 'CLI-агенты работают в папке проекта: могут читать и изменять файлы и выполнять команды в пределах настроенных разрешений. Переписка и действия видны в дочернем чате.',
      add: 'Добавить аккаунт', addTitle: 'Новый аккаунт', addHelp: 'Новый аккаунт выключен. Сначала войдите в него, затем разрешите делегирование.',
      refreshAll: 'Обновить лимиты', refresh: 'Обновить', verifySignIn: 'Проверить вход', retry: 'Повторить загрузку',
      provider: 'Провайдер', name: 'Название (необязательно)', editName: 'Название', nameHint: 'Например: Личный аккаунт',
      noCli: 'CLI не найден', noProviders: 'Установите Codex CLI или Claude Code на компьютере, где запущен DSH.',
      accounts: 'Аккаунты', loading: 'Загрузка аккаунтов…', empty: 'Аккаунтов пока нет', emptyHelp: 'Добавьте аккаунт и войдите в него в браузере на компьютере с DSH.',
      listError: 'Не удалось загрузить аккаунты.', staleList: 'Не удалось обновить список. Показаны последние полученные данные.',
      requestError: 'Не удалось связаться с DSH.', invalidResponse: 'Сервер вернул неожиданный ответ.', sessionError: 'Откройте или обновите авторизованную страницу DSH.',
      unknown: 'Статус неизвестен', new: 'Нужен вход', loginStatus: 'Ожидает входа', ready: 'Готов', error: 'Требует внимания',
      login: 'Войти', loginAgain: 'Войти заново', stop: 'Отменить вход', loginHelp: 'Завершите вход в системном браузере на компьютере с DSH. Статус обновится здесь.', openSignIn: 'Открыть страницу входа', delegating: 'Агент выполняет поручение…',
      test: 'Проверить', rename: 'Переименовать', remove: 'Удалить', save: 'Сохранить', close: 'Отмена',
      enabled: 'Делегирование разрешено', disabled: 'Делегирование выключено', switchLabel: 'Разрешить делегирование', gate: 'Перед включением пройдите проверку аккаунта: нажмите «Проверить».',
      confirmEnable: 'Разрешить делегирование этому аккаунту?', enableHelp: 'Агент получает доступ к проекту и может отправлять содержимое прочитанных файлов своему провайдеру. Сейчас запуск доступен только из сессии DSH с полным доступом. Codex ограничивает запись рабочей областью; Claude Code использует acceptEdits. Включайте только для доверенных проектов.', enable: 'Разрешить',
      confirmRemove: 'Удалить аккаунт из плагина?', removeHelp: 'Плагин удалит аккаунт из списка и завершит его сеанс CLI, если он был подключён.',
      footer: 'Лимиты агентов', left: 'осталось {percent}%', usageCaveat: 'Claude Code сообщает о лимитах не при каждой проверке. Здесь показаны последние доступные данные.',
      usage: 'Лимиты подписки', usageUnknown: 'Нет данных о лимитах', usageStale: 'Данные могли устареть', lastUpdated: 'Обновлено: {date}', lastChecked: 'Проверено: {date}',
      period: 'Лимит', fiveHour: 'Пятичасовой лимит', weekly: 'Недельный лимит', untilReset: 'До сброса: {duration}', resetPending: 'Ожидается обновление лимита', dayUnit: 'дн.', hourUnit: 'ч', minuteUnit: 'мин', underMinute: 'меньше минуты', durationReset: 'Сброс: {date}', resetUnknown: 'Сброс неизвестен',
      adding: 'Добавление…', launching: 'Запуск входа…', cancelling: 'Отмена входа…', refreshing: 'Обновление лимитов…', testing: 'Проверка аккаунта…',
      saving: 'Сохранение…', removing: 'Удаление…', working: 'Операция выполняется…',
      added: 'Аккаунт добавлен. Теперь можно войти.', launched: 'Запрошен вход. Проверьте системный браузер на компьютере с DSH.',
      cancelled: 'Вход отменён.', refreshed: 'Запрошено обновление лимитов.', tested: 'Проверка запущена. Результат появится в карточке аккаунта.',
      taskAgents: 'Агенты этой задачи', parentChat: 'Основной чат', childChat: 'Дочерний чат', nativeChat: 'Открыть обычный чат агента', runningChild: 'Работает', idleChild: 'Неактивен', completedChild: 'Завершён', waitingChild: 'Ожидает решения', childLoadError: 'Не удалось обновить список агентов.', refreshChildren: 'Обновить список агентов',
      saved: 'Название сохранено.', switched: 'Настройка делегирования сохранена.', removed: 'Аккаунт удалён.',
    };
    const en = {
      panel: 'Subscription agents', title: 'Subscription agents',
      intro: 'Connect Codex and Claude Code as full project agents with their own child conversations.',
      privacy: 'CLI agents work in the project directory: they can read and edit files and run commands within configured permissions. Their conversation and activity appear in the child chat.',
      add: 'Add account', addTitle: 'New account', addHelp: 'The new account starts disabled. Sign in first, then allow delegation.',
      refreshAll: 'Refresh limits', refresh: 'Refresh', verifySignIn: 'Check sign-in', retry: 'Retry loading',
      provider: 'Provider', name: 'Name (optional)', editName: 'Name', nameHint: 'For example: Personal account',
      noCli: 'CLI not found', noProviders: 'Install Codex CLI or Claude Code on the computer running DSH.',
      accounts: 'Accounts', loading: 'Loading accounts…', empty: 'No accounts yet', emptyHelp: 'Add an account and sign in using the browser on the computer running DSH.',
      listError: 'Could not load accounts.', staleList: 'Could not reload the list. Showing the last snapshot.',
      requestError: 'Could not contact DSH.', invalidResponse: 'The server returned an unexpected response.', sessionError: 'Open or reload an authenticated DSH page.',
      unknown: 'Status unknown', new: 'Sign-in required', loginStatus: 'Waiting for sign-in', ready: 'Ready', error: 'Needs attention',
      login: 'Sign in', loginAgain: 'Sign in again', stop: 'Cancel sign-in', loginHelp: 'Complete sign-in in the system browser on the computer running DSH. The status will update here.', openSignIn: 'Open sign-in page', delegating: 'Agent is working on a delegated prompt…',
      test: 'Test', rename: 'Rename', remove: 'Remove', save: 'Save', close: 'Cancel',
      enabled: 'Delegation allowed', disabled: 'Delegation off', switchLabel: 'Allow delegation', gate: 'Before enabling delegation, select Test and wait for the account to pass.',
      confirmEnable: 'Allow delegation to this account?', enableHelp: 'The agent receives project access and may send the contents of files it reads to its provider. Launch currently requires a DSH session with Full access. Codex limits writes to the workspace; Claude Code uses acceptEdits. Enable only for trusted projects.', enable: 'Allow',
      confirmRemove: 'Remove this account from the plugin?', removeHelp: 'The plugin will remove the account from the list and sign out its CLI session if it was connected.',
      footer: 'Agent limits', left: '{percent}% remaining', usageCaveat: 'Claude Code does not report limits on every check. The last available data is shown here.',
      usage: 'Subscription limits', usageUnknown: 'No usage data', usageStale: 'Usage data may be out of date', lastUpdated: 'Updated: {date}', lastChecked: 'Checked: {date}',
      period: 'Limit', fiveHour: 'Five-hour limit', weekly: 'Weekly limit', untilReset: 'Resets in: {duration}', resetPending: 'Waiting for updated limits', dayUnit: 'd', hourUnit: 'h', minuteUnit: 'min', underMinute: 'less than a minute', durationReset: 'Resets: {date}', resetUnknown: 'Reset time unknown',
      adding: 'Adding…', launching: 'Opening sign-in…', cancelling: 'Cancelling sign-in…', refreshing: 'Refreshing limits…', testing: 'Testing account…',
      saving: 'Saving…', removing: 'Removing…', working: 'Working…',
      added: 'Account added. You can now sign in.', launched: 'Sign-in requested. Check the system browser on the computer running DSH.',
      cancelled: 'Sign-in cancelled.', refreshed: 'Limit refresh requested.', tested: 'Test started. The result will appear on the account card.',
      taskAgents: 'Task agents', parentChat: 'Parent conversation', childChat: 'Child conversation', nativeChat: 'Open the agent conversation', runningChild: 'Running', idleChild: 'Inactive', completedChild: 'Completed', waitingChild: 'Waiting for input', childLoadError: 'Could not refresh the agent list.', refreshChildren: 'Refresh agent list',
      saved: 'Name saved.', switched: 'Delegation setting saved.', removed: 'Account removed.',
    };
    const styles = `
      .dsa-panel { box-sizing:border-box; block-size:100%; min-block-size:0; overflow:auto; color:var(--dsw-alias-label-primary); font-size:14px; line-height:1.5; }
      .dsa-panel *, .dsa-panel *::before, .dsa-panel *::after { box-sizing:border-box; }
      .dsa-inner { max-inline-size:960px; margin-inline:auto; padding:clamp(20px,4vw,44px); padding-block-end:48px; display:grid; gap:24px; min-inline-size:0; }
      .dsa-head, .dsa-list, .dsa-card, .dsa-form { display:grid; gap:12px; min-inline-size:0; }
      .dsa-panel h1, .dsa-panel h2, .dsa-panel h3, .dsa-panel p { margin:0; overflow-wrap:anywhere; }
      .dsa-panel h1 { font-size:26px; line-height:1.25; letter-spacing:-.025em; font-weight:650; }
      .dsa-panel h2 { font-size:13px; color:var(--dsw-alias-label-secondary); font-weight:600; }
      .dsa-panel h3 { font-size:17px; font-weight:630; letter-spacing:-.015em; }
      .dsa-head > p { max-inline-size:72ch; }
      .dsa-subtle, .dsa-meta { color:var(--dsw-alias-label-secondary); }
      .dsa-meta { font-size:12px; }
      .dsa-toolbar, .dsa-row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; min-inline-size:0; }
      .dsa-toolbar { margin-block-start:6px; }
      .dsa-spread { justify-content:space-between; }
      .dsa-card, .dsa-form, .dsa-message { padding:clamp(16px,2.4vw,24px); border:1px solid var(--dsw-alias-border-l1); border-radius:16px; background:var(--dsw-alias-bg-layer-1); }
      .dsa-card { gap:18px; }
      .dsa-card > header > div { display:grid; gap:3px; }
      .dsa-form { gap:14px; background:var(--dsw-alias-bg-layer-2); }
      .dsa-panel fieldset { margin:0; min-inline-size:0; }
      .dsa-panel legend { padding-inline:5px; font-weight:600; }
      .dsa-fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,195px),1fr)); gap:12px; }
      .dsa-field { display:grid; gap:6px; min-inline-size:0; }
      .dsa-panel button, .dsa-panel input, .dsa-panel select { font:inherit; font-size:13px; min-inline-size:0; max-inline-size:100%; border:1px solid var(--dsw-alias-border-l2); border-radius:9px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); min-block-size:34px; box-shadow:none; }
      .dsa-panel button { padding:6px 12px; cursor:pointer; white-space:normal; overflow-wrap:anywhere; text-align:start; }
      .dsa-panel input, .dsa-panel select { inline-size:100%; padding:7px 10px; }
      .dsa-panel button.dsa-primary { border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,var(--dsw-alias-border-l1)); background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,var(--dsw-alias-bg-layer-1)); color:var(--dsw-alias-label-primary); font-weight:600; }
      .dsa-panel button.dsa-danger { color:var(--dsw-alias-state-error-primary); }
      .dsa-panel button:disabled { opacity:.45; cursor:not-allowed; }
      .dsa-panel :is(button,input,select,a):focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:3px; }
      .dsa-panel button:not(:disabled):active { transform:scale(.98); }
      @media (hover:hover) and (pointer:fine) {
        .dsa-panel button:not(:disabled):hover { background:var(--dsw-alias-bg-layer-2); }
        .dsa-panel button.dsa-primary:not(:disabled):hover { background:color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,var(--dsw-alias-bg-layer-1)); }
      }
      @media (pointer:coarse) { .dsa-panel input, .dsa-panel select { font-size:16px; } .dsa-panel button { min-block-size:42px; } }
      .dsa-badge { display:inline-flex; align-items:center; gap:6px; max-inline-size:100%; overflow-wrap:anywhere; border-radius:999px; padding:3px 9px; font-size:11px; font-weight:550; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-secondary); }
      .dsa-badge::before { content:''; inline-size:5px; block-size:5px; border-radius:50%; background:currentColor; flex:none; }
      .dsa-badge[data-status=ready] { color:var(--dsw-alias-state-success-primary); }
      .dsa-badge[data-status=error], .dsa-error { color:var(--dsw-alias-state-error-primary); }
      .dsa-badge[data-status=login], .dsa-warn { color:var(--dsw-alias-state-warn-primary); }
      .dsa-usage { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr)); gap:14px; min-inline-size:0; }
      .dsa-usage > :not(.dsa-window) { grid-column:1/-1; }
      .dsa-usage > .dsa-row strong { font-size:12px; font-weight:550; color:var(--dsw-alias-label-secondary); }
      .dsa-window { display:grid; gap:10px; min-inline-size:0; padding:16px; border:1px solid var(--dsw-alias-border-l1); border-radius:12px; background:var(--dsw-alias-bg-base); }
      .dsa-window > strong { font-size:13px; font-weight:550; }
      .dsa-window .dsa-row { align-items:baseline; gap:6px; }
      .dsa-window .dsa-row > :last-child { color:var(--dsw-alias-label-primary); font-variant-numeric:tabular-nums; font-weight:600; }
      .dsa-track { display:block; block-size:5px; border-radius:999px; overflow:hidden; background:var(--dsw-alias-border-l1); }
      .dsa-track span { display:block; block-size:100%; border-radius:inherit; background:var(--dsw-alias-brand-primary); }
      .dsa-track[data-stale=true] span { background:var(--dsw-alias-label-secondary); }
      .dsa-panel a { color:var(--dsw-alias-brand-primary); text-decoration:underline; text-underline-offset:3px; }
      .dsa-note { white-space:pre-wrap; overflow-wrap:anywhere; }
      .dsa-actions { padding-block-start:14px; border-block-start:1px solid var(--dsw-alias-border-l1); gap:4px; }
      .dsa-actions button { border-color:transparent; background:transparent; padding-inline:9px; color:var(--dsw-alias-label-secondary); font-size:12px; }
      .dsa-actions button.dsa-primary { color:var(--dsw-alias-label-primary); }
      .dsa-actions button.dsa-danger { margin-inline-start:auto; }
      .dsa-panel button.dsa-switch { display:inline-flex; gap:9px; align-items:center; padding:0; min-block-size:28px; background:transparent; border:0; color:var(--dsw-alias-label-secondary); font-size:12px; }
      .dsa-panel button.dsa-switch:hover { background:transparent; }
      .dsa-switch-mark { inline-size:28px; block-size:16px; padding:2px; border-radius:999px; display:inline-flex; flex:none; background:var(--dsw-alias-border-l2); }
      .dsa-switch-mark::before { content:''; inline-size:12px; block-size:12px; border-radius:50%; background:var(--dsw-alias-label-primary); }
      .dsa-switch[aria-checked=true] .dsa-switch-mark { justify-content:flex-end; background:var(--dsw-alias-brand-primary); }
      @media (pointer:coarse) { .dsa-panel button.dsa-switch { min-block-size:42px; } }
      @media (max-width:600px) { .dsa-usage { grid-template-columns:minmax(0,1fr); } .dsa-inner { padding:20px 16px; } .dsa-usage > .dsa-row { align-items:start; } }
    `;
    const footerStyles = `
      .dsa-footer { display:grid; gap:2px; min-inline-size:0; }
      .dsa-footer button { display:flex; align-items:center; gap:6px; inline-size:100%; min-inline-size:0; min-block-size:32px; border:0; border-radius:8px; background:transparent; color:var(--dsw-alias-label-primary); padding:4px 8px; font:inherit; text-align:start; cursor:pointer; }
      .dsa-footer button:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary); outline-offset:-2px; }
      @media (hover:hover) { .dsa-footer button:hover { background:var(--dsw-alias-button-tool-bar-hover); } }
      .dsa-footer[data-rail] button { inline-size:36px; min-block-size:36px; justify-content:center; padding:0; margin-inline:auto; }
      .dsa-footer h2 { margin:0; font-size:.88em; font-weight:600; }
      .dsa-footer svg { flex:none; }
      .dsa-footer-label { flex:1; min-inline-size:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .dsa-footer-value { flex:none; color:var(--dsw-alias-label-secondary); font-size:.88em; font-variant-numeric:tabular-nums; }
      .dsa-footer-rows { max-block-size:min(106px,16vh); overflow:auto; padding-inline-start:8px; }
    `;
    const progress = { add: 'adding', login: 'launching', cancel: 'cancelling', refresh: 'refreshing', test: 'testing', rename: 'saving', toggle: 'saving', remove: 'removing', delegate: 'delegating' };
    const success = { add: 'added', login: 'launched', cancel: 'cancelled', refresh: 'refreshed', test: 'tested', rename: 'saved', toggle: 'switched', remove: 'removed' };

    async function call(action, payload, signal) {
      const base = document.querySelector('base[href]') ? document.baseURI : new URL('.', window.location.href);
      const url = new URL('api/subscription-agents', base);
      if (url.origin !== window.location.origin) return { ok: false, message: 'requestError' };
      try {
        const deadline = AbortSignal.timeout(action === 'remove' ? 90000 : 20000);
        const response = await fetch(url, {
          method: 'POST', credentials: 'same-origin', redirect: 'error', signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-DSH-Subscription-Agents': '1' },
          body: JSON.stringify({ ...payload, action }),
        });
        if ([401, 403].includes(response.status)) return { ok: false, message: 'sessionError' };
        const result = await response.json().catch(() => null);
        if (signal?.aborted) return null;
        if (response.ok && result?.ok === true) return result;
        return { ok: false, message: 'invalidResponse', error: typeof result?.error === 'string' ? result.error : undefined };
      } catch {
        return signal?.aborted ? null : { ok: false, message: 'requestError' };
      }
    }

    function safeLoginUrl(account) {
      if (typeof account.loginUrl !== 'string') return null;
      try {
        const url = new URL(account.loginUrl);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
          && /oauth|authorize/.test(url.pathname) && url.href.length < 8192
          && signInHosts[account.provider]?.has(url.hostname) ? url.href : null;
      } catch { return null; }
    }
    function stamp(value) {
      return Number.isFinite(value) && value > 0 && !Number.isNaN(new Date(value).getTime()) ? value : null;
    }
    function formatDate(value) {
      const date = new Date(value);
      try { return new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
      catch { return date.toLocaleString(); }
    }
    function Button({ children, type = 'button', variant, ...props }) {
      return h('button', { type, ...props, className: [props.className, variant && `dsa-${variant}`].filter(Boolean).join(' ') }, children);
    }
    function PanelIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 2.25, y: 3, width: 11.5, height: 10, rx: 2 }),
        h('path', { d: 'm4.75 6 2 2-2 2m3.75 0h2.75' }));
    }

    function isStale(account, win, now) {
      const sample = stamp(win.sampledAt) ?? stamp(account.usage?.updatedAt);
      const reset = stamp(win.resetAt);
      return !sample || now - sample >= 6 * 60 * 1000 || account.status === 'error' || (reset !== null && reset <= now);
    }
    function remaining(account) {
      const windows = account.usage?.windows;
      if (account.status !== 'ready' || !Array.isArray(windows)) return null;
      const window = windows.find(win => win && /^(5\s*h|5 часов)$/.test(typeof win.label === 'string' ? win.label.trim() : ''));
      if (!window || !Number.isFinite(window.usedPercent) || isStale(account, window, Date.now())) return null;
      return percentLeft(window.usedPercent);
    }

    function SidebarUsage({ wide, t, openPanel }) {
      const [snapshot, setSnapshot] = useState(null);
      useEffect(() => {
        if (!wide) return undefined;
        const controller = new AbortController();
        let active = false;
        async function update() {
          if (active || document.visibilityState === 'hidden') return;
          active = true;
          const result = await call('list', {}, controller.signal);
          active = false;
          if (controller.signal.aborted) return;
          setSnapshot(result?.ok && Array.isArray(result.accounts) ? result.accounts : null);
        }
        void update();
        const timer = window.setInterval(update, 20000);
        document.addEventListener('visibilitychange', update);
        return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
      }, [wide]);
      return h('section', { className: 'dsa-footer', 'data-rail': !wide || undefined, 'aria-label': t('footer') }, h('style', null, footerStyles),
        h('h2', null, h('button', { type: 'button', onClick: () => openPanel(), 'aria-label': t('footer'), title: t('footer') }, h(PanelIcon),
          wide && h('span', { className: 'dsa-footer-label' }, t('footer')))),
        wide && snapshot?.length > 0 && h('div', { className: 'dsa-footer-rows' }, snapshot.map(account => {
          const name = `#${account.number} · ${account.name || providers[account.provider] || t('unknown')}`;
          const value = remaining(account);
          const title = `${name} · ${t('fiveHour')}: ${value === null ? t('usageUnknown') : t('left', { percent: value })}`;
          return h('button', { key: account.id, type: 'button', title, 'aria-label': title, onClick: () => openPanel(account.id) },
            h('span', { className: 'dsa-footer-label' }, name), h('span', { className: 'dsa-footer-value', 'aria-hidden': true }, value === null ? '—' : `${value}%`));
        })));
    }

    function TaskAgents({ wide, t, useSessions, useSessionStatus, openNativeSession, refreshChildren }) {
      const listing = useSessions(state => state);
      const statuses = useSessionStatus(state => state);
      const current = Object.values(listing.byId).find(row => (row.retainedBy?.mainView ?? 0) > 0);
      const parentId = current?.origin === 'subagent' ? current.parentId : current?.id;
      const summary = parentId ? listing.byId[parentId] : undefined;
      const catalog = parentId ? listing.projectionsBySession[parentId] : undefined;
      const children = (catalog?.values?.subagentCatalog ?? []).filter(entry => entry.mode === 'continuable');
      const [error, setError] = useState(false);
      const [refreshing, setRefreshing] = useState(false);
      useEffect(() => {
        let disposed = false;
        setError(false);
        if (!parentId) return undefined;
        setRefreshing(true);
        Promise.resolve(refreshChildren(parentId)).catch(() => { if (!disposed) setError(true); })
          .finally(() => { if (!disposed) setRefreshing(false); });
        return () => { disposed = true; };
      }, [parentId]);
      async function retry() {
        if (refreshing || !parentId) return;
        setRefreshing(true); setError(false);
        try { await refreshChildren(parentId); } catch { setError(true); }
        finally { setRefreshing(false); }
      }
      if (!parentId || (children.length === 0 && !error)) return null;
      const parentTitle = summary?.displayTitle || t('parentChat');
      return h('section', { className: 'dsa-footer dsa-task-tree', 'data-rail': !wide || undefined, 'aria-label': t('taskAgents') },
        h('style', null, footerStyles + `
          .dsa-task-tree { border-block-start:1px solid var(--dsw-alias-border-l1); padding-block-start:7px; margin-block-end:7px; }
          .dsa-task-tree .dsa-child-list { margin:0 0 0 14px; padding:0 0 0 5px; list-style:none; border-inline-start:1px solid var(--dsw-alias-border-l1); max-block-size:min(180px,24vh); overflow:auto; }
          .dsa-task-tree .dsa-child-label { display:grid; gap:1px; flex:1; min-inline-size:0; }
          .dsa-task-tree .dsa-child-status { font-size:10px; color:var(--dsw-alias-label-secondary); }
          .dsa-task-tree .dsa-child-dot { inline-size:5px; block-size:5px; border-radius:50%; background:var(--dsw-alias-label-secondary); flex:none; }
          .dsa-task-tree .dsa-child-dot[data-status=running] { background:var(--dsw-alias-brand-primary); }
          .dsa-task-tree .dsa-child-dot[data-status=waiting] { background:var(--dsw-alias-state-warn-primary); }
          .dsa-task-tree button[aria-current=page] { background:var(--dsw-alias-bg-layer-2); }
          .dsa-task-tree .dsa-tree-tools { display:flex; align-items:center; gap:3px; }
          .dsa-task-tree .dsa-tree-refresh { inline-size:28px; flex:none; justify-content:center; padding:3px; }
          .dsa-task-tree .dsa-tree-error { margin:4px 8px; color:var(--dsw-alias-state-error-primary); font-size:11px; }
        `),
        h('h2', { className: 'dsa-tree-tools' },
          h('button', { type: 'button', onClick: () => openNativeSession(parentId), title: t('taskAgents'), 'aria-label': t('taskAgents') },
            h(PanelIcon), wide && h('span', { className: 'dsa-footer-label' }, t('taskAgents'))),
          wide && h('button', { type: 'button', className: 'dsa-tree-refresh', disabled: refreshing, 'aria-label': t('refreshChildren'), title: t('refreshChildren'), onClick: retry }, '↻')),
        wide && h('button', { type: 'button', title: `${t('parentChat')}: ${parentTitle}`, 'aria-label': `${t('parentChat')}: ${parentTitle}`, 'aria-current': current?.id === parentId ? 'page' : undefined, onClick: () => openNativeSession(parentId) },
          h('span', { 'aria-hidden': true }, '↖'), h('span', { className: 'dsa-footer-label' }, parentTitle)),
        wide && children.length > 0 && h('ul', { className: 'dsa-child-list' }, children.map(entry => {
          const childSummary = listing.byId[entry.id];
          const status = statuses.get(entry.id);
          const activity = status?.pendingInteraction ? 'waiting' : (status?.running ?? childSummary?.running) ? 'running'
            : childSummary?.projectionValues?.subagentTiming?.lastTurnCompleted === true ? 'completed' : 'idle';
          const title = entry.label || entry.name || childSummary?.displayTitle || t('childChat');
          const statusText = t({ waiting:'waitingChild', running:'runningChild', completed:'completedChild', idle:'idleChild' }[activity]);
          return h('li', { key: entry.id }, h('button', {
            type: 'button', title: `${title} · ${statusText}`, 'aria-label': `${t('nativeChat')}: ${title} · ${statusText}`,
            'aria-current': current?.id === entry.id ? 'page' : undefined,
            onClick: () => openNativeSession({ parentSessionId: parentId, childSessionId: entry.id, mode: entry.mode }),
          }, h('span', { className: 'dsa-child-dot', 'data-status': activity, 'aria-hidden': true }),
          h('span', { className: 'dsa-child-label' }, h('span', { className: 'dsa-footer-label' }, title), h('span', { className: 'dsa-child-status' }, statusText))));
        })),
        wide && error && h('p', { role: 'status', className: 'dsa-tree-error' }, t('childLoadError')));
    }

    function percentLeft(used) {
      return Number.isFinite(used) ? Math.max(0, Math.min(100, Math.floor(100 - used))) : null;
    }
    function resetDuration(reset, now, t) {
      const minutes = Math.floor((reset - now) / 60000);
      if (reset <= now) return t('resetPending');
      if (minutes < 1) return t('untilReset', { duration: t('underMinute') });
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor(minutes % 1440 / 60);
      const mins = minutes % 60;
      const duration = days ? `${days} ${t('dayUnit')}${hours ? ` ${hours} ${t('hourUnit')}` : ''}`
        : hours ? `${hours} ${t('hourUnit')}${mins ? ` ${mins} ${t('minuteUnit')}` : ''}` : `${mins} ${t('minuteUnit')}`;
      return t('untilReset', { duration });
    }
    function Usage({ account, t }) {
      const [now, setNow] = useState(Date.now);
      useEffect(() => {
        const update = () => setNow(Date.now());
        const timer = window.setInterval(update, 1000);
        document.addEventListener('visibilitychange', update);
        return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
      }, []);
      const windows = Array.isArray(account.usage?.windows) ? account.usage.windows.filter(win => win && typeof win === 'object') : [];
      const updated = stamp(account.usage?.updatedAt);
      const checked = stamp(account.checkedAt);
      const stale = windows.some(win => isStale(account, win, now));
      return h('section', { className: 'dsa-usage', 'aria-label': t('usage') },
        h('div', { className: 'dsa-row dsa-spread' }, h('strong', null, t('usage')),
          windows.length > 0 && updated && h('span', { className: 'dsa-meta' }, t('lastUpdated', { date: formatDate(updated) }))),
        stale && h('p', { className: 'dsa-meta dsa-warn' }, t('usageStale')),
        windows.length === 0 && h('p', { className: 'dsa-meta' }, t('usageUnknown')),
        windows.map((win, index) => {
          const pct = percentLeft(win.usedPercent);
          const rawLabel = typeof win.label === 'string' ? win.label.trim() : '';
          const label = /^(5\s*h|5 часов)$/.test(rawLabel) ? t('fiveHour') : /^(7\s*d|7 дней)$/.test(rawLabel) ? t('weekly') : rawLabel || t('period');
          const reset = stamp(win.resetAt);
          return h('div', { className: 'dsa-window', key: index },
            h('strong', null, label),
            h('div', { className: 'dsa-row dsa-spread' },
              h('span', { className: 'dsa-meta', title: reset ? t('durationReset', { date: formatDate(reset) }) : undefined }, reset ? resetDuration(reset, now, t) : t('resetUnknown')),
              h('span', { className: 'dsa-meta' }, pct === null ? t('usageUnknown') : t('left', { percent: pct }))),
            pct !== null && h('div', { className: 'dsa-track', 'aria-hidden': true, 'data-stale': isStale(account, win, now) }, h('span', { style: { width: `${pct}%` } })));
        }),
        account.provider === 'claude' && h('p', { className: 'dsa-meta' }, t('usageCaveat')),
        checked !== null && checked !== updated && h('p', { className: 'dsa-meta' }, t('lastChecked', { date: formatDate(checked) })));
    }

    function Editor({ kind, account, available, onSubmit, onClose, pending, t }) {
      const add = kind === 'add';
      const rename = kind === 'rename';
      const remove = kind === 'remove';
      const enable = kind === 'enable';
      const choices = Object.keys(providers).filter(provider => available[provider] === true);
      const [provider, setProvider] = useState(choices[0] || '');
      const [name, setName] = useState(rename ? account.name || '' : '');
      const first = useRef(null);
      useEffect(() => { first.current?.focus(); }, []);
      const effectiveProvider = choices.includes(provider) ? provider : choices[0] || '';
      return h('form', {
        onSubmit(event) {
          event.preventDefault();
          if (pending || (add && !effectiveProvider) || (rename && !name.trim())) return;
          if (add) onSubmit('add', { provider: effectiveProvider, ...(name.trim() ? { name: name.trim() } : {}) });
          else if (rename) onSubmit('rename', { id: account.id, name: name.trim() });
          else if (remove) onSubmit('remove', { id: account.id });
          else onSubmit('toggle', { id: account.id, enabled: true });
        },
        onKeyDown(event) {
          if (event.key === 'Escape' && !pending) { event.stopPropagation(); onClose(); }
        },
      }, h('fieldset', { className: 'dsa-form', disabled: pending },
        h('legend', null, t(add ? 'addTitle' : rename ? 'rename' : remove ? 'confirmRemove' : 'confirmEnable')),
        (add || remove || enable) && h('p', { className: 'dsa-subtle' }, t(add ? 'addHelp' : remove ? 'removeHelp' : 'enableHelp')),
        (add || rename) && h('div', { className: 'dsa-fields' },
          add && h('label', { className: 'dsa-field' }, t('provider'), h('select', {
            ref: first, value: effectiveProvider, onChange: event => setProvider(event.target.value), required: true,
          }, !effectiveProvider && h('option', { value: '' }, t('noCli')),
          Object.entries(providers).map(([id, label]) => h('option', { value: id, key: id, disabled: !available[id] }, available[id] ? label : `${label} — ${t('noCli')}`)))),
          h('label', { className: 'dsa-field' }, t(add ? 'name' : 'editName'), h('input', {
            ref: rename ? first : undefined, value: name, onChange: event => setName(event.target.value), placeholder: t('nameHint'), maxLength: 70, required: rename,
          }))),
        h('div', { className: 'dsa-row' },
          h('button', { type: 'button', ref: remove || enable ? first : undefined, onClick: onClose }, t('close')),
          h(Button, { type: 'submit', variant: remove ? 'danger' : 'primary', disabled: (add && !effectiveProvider) || (rename && !name.trim()) },
            t(add ? 'add' : rename ? 'save' : remove ? 'remove' : 'enable')))));
    }

    function Account({ account, available, edit, pending, begin, close, run, notice, focusTarget, t }) {
      const heading = useId();
      const card = useRef(null);
      const { id } = account;
      useEffect(() => {
        if (focusTarget?.id !== id) return;
        card.current?.focus({ preventScroll: true });
        card.current?.scrollIntoView({ block: 'nearest' });
      }, [focusTarget, id]);
      const loginActive = account.status === 'login' || account.busy === 'login';
      const loginUrl = account.status === 'login' ? safeLoginUrl(account) : null;
      const currentPending = pending?.id === id;
      const pendingAction = currentPending ? pending.action : account.busy;
      const running = Boolean(pendingAction || loginActive);
      const cli = available[account.provider] === true;
      const rowName = account.name || providers[account.provider] || t('unknown');
      const stateKey = { new: 'new', login: 'loginStatus', ready: 'ready', error: 'error' }[account.status] || 'unknown';
      function act(action, extra) { run(action, { id, ...extra }); }
      return h('article', { className: 'dsa-card', ref: card, tabIndex: -1, 'aria-labelledby': heading },
        h('header', { className: 'dsa-row dsa-spread' },
          h('div', null, h('p', { className: 'dsa-meta' }, [account.number == null ? null : `#${account.number}`, providers[account.provider]].filter(Boolean).join(' · ')), h('h3', { id: heading }, rowName)),
          h('span', { className: 'dsa-badge', 'data-status': account.status }, t(stateKey))),
        !cli && h('p', { className: 'dsa-meta dsa-warn' }, t('noCli')),
        h('div', { className: 'dsa-row' },
          h(Button, {
            role: 'switch', 'aria-checked': Boolean(account.enabled), 'aria-label': `${t('switchLabel')}: ${rowName}`,
            className: 'dsa-switch', disabled: Boolean(pending) || (!account.enabled && (!cli || account.status !== 'ready' || account.testPassed !== true || running)),
            onClick: event => account.enabled ? act('toggle', { enabled: false }) : begin('enable', id, event.currentTarget),
          }, h('span', { className: 'dsa-switch-mark', 'aria-hidden': true }), t(account.enabled ? 'enabled' : 'disabled'))),
        !account.enabled && cli && account.status === 'ready' && account.testPassed !== true && !running && h('p', { className: 'dsa-meta' }, t('gate')),
        pendingAction && h('p', { role: 'status', className: 'dsa-meta' }, t(progress[pendingAction] || 'working')),
        account.status === 'login' && h('p', { className: 'dsa-subtle' }, t('loginHelp')),
        loginUrl && h('p', null, h('a', { href: loginUrl, target: '_blank', rel: 'noopener noreferrer' }, t('openSignIn'))),
        account.note && h('p', { className: 'dsa-meta dsa-note', 'aria-live': 'polite' }, account.note),
        h(Usage, { account, t }),
        h('div', { className: 'dsa-row dsa-actions' },
          loginActive ? h(Button, { disabled: Boolean(pending), onClick: () => act('cancel') }, t('stop')) :
            h(Button, { variant: account.status === 'ready' ? undefined : 'primary', disabled: Boolean(pending) || !cli || running, onClick: () => act('login') }, t(account.status === 'ready' ? 'loginAgain' : 'login')),
          h(Button, { disabled: Boolean(pending) || !cli || running || !['ready', 'error'].includes(account.status), onClick: () => act('refresh') }, t(account.provider === 'claude' ? 'verifySignIn' : 'refresh')),
          h(Button, { disabled: Boolean(pending) || !cli || running || !['ready', 'error'].includes(account.status), onClick: () => act('test') }, t('test')),
          h(Button, { disabled: Boolean(pending) || running, onClick: event => begin('rename', id, event.currentTarget) }, t('rename')),
          h(Button, { variant: 'danger', disabled: Boolean(pending) || running, onClick: event => begin('remove', id, event.currentTarget) }, t('remove'))),
        edit && h(Editor, { key: edit.kind, kind: edit.kind, account, available, pending: Boolean(pending), onSubmit: run, onClose: close, t }),
        notice && h('p', { className: `dsa-note${notice.error ? ' dsa-error' : ''}`, role: notice.error ? 'alert' : 'status' }, notice.text));
    }

    function Panel({ t, usePanelTarget }) {
      const requested = usePanelTarget();
      const [added, setAdded] = useState(null);
      const [snapshot, setSnapshot] = useState(null);
      const [listError, setListError] = useState(null);
      const [pending, setPending] = useState(null);
      const [notice, setNotice] = useState(null);
      const [edit, setEdit] = useState(null);
      const [checkUntil, setCheckUntil] = useState(0);
      const lifecycle = useRef(null);
      const requestId = useRef(0);
      const listRequest = useRef(null);
      const actionLock = useRef(false);
      const trigger = useRef(null);
      const addButton = useRef(null);
      const heading = useId();
      const listHeading = useId();
      const accounts = snapshot?.accounts || [];
      const available = snapshot?.available || {};
      const rapid = checkUntil > Date.now() || accounts.some(account => account.busy || account.status === 'login');
      const hasProvider = Object.keys(providers).some(provider => available[provider] === true);

      async function load(force = false) {
        const signal = lifecycle.current?.signal;
        if (!signal || signal.aborted) return;
        if (listRequest.current?.signal === signal && !force) return;
        const id = ++requestId.current;
        const request = { id, signal };
        listRequest.current = request;
        const result = await call('list', {}, signal);
        if (listRequest.current === request) listRequest.current = null;
        if (!result || signal.aborted || id !== requestId.current) return;
        if (!result.ok || !Array.isArray(result.accounts)) {
          setListError(result.error ? { text: result.error } : { key: result.message || 'invalidResponse' });
          return;
        }
        setListError(null);
        setSnapshot({ accounts: result.accounts, available: result.available || {} });
        if (result.accounts.some(account => account.busy || account.status === 'login')) setCheckUntil(0);
      }
      useEffect(() => {
        const controller = new AbortController();
        lifecycle.current = controller;
        void load();
        return () => controller.abort();
      }, []);
      useEffect(() => {
        const timer = window.setInterval(() => {
          if (document.visibilityState !== 'hidden' && !actionLock.current) void load();
        }, rapid ? 1800 : 15000);
        return () => window.clearInterval(timer);
      }, [rapid]);

      function begin(kind, id, button) {
        if (actionLock.current) return;
        trigger.current = button;
        setNotice(null);
        setEdit({ kind, id });
      }
      function close(focusFallback = false) {
        setEdit(null);
        const button = focusFallback ? addButton.current : trigger.current;
        button?.focus();
        trigger.current = null;
      }
      async function run(action, payload = {}) {
        const signal = lifecycle.current?.signal;
        if (!signal || signal.aborted || actionLock.current) return;
        actionLock.current = true;
        setPending({ action, id: payload.id });
        setNotice(null);
        let focusTarget;
        try {
          const result = await call(action, payload, signal);
          if (!result || signal.aborted) return;
          if (result.ok) {
            setNotice({ id: action === 'remove' ? undefined : payload.id, key: success[action] });
            if (['login', 'refresh', 'test', 'cancel'].includes(action)) setCheckUntil(Date.now() + 16000);
            if ((edit?.kind === action || (edit?.kind === 'enable' && action === 'toggle')) && edit.id === payload.id) {
              if (action === 'add' && result.account?.id) setAdded({ id: result.account.id, at: Date.now() });
              else focusTarget = action === 'remove' ? addButton.current : trigger.current;
              setEdit(null);
              trigger.current = null;
            }
          } else {
            setNotice({ id: payload.id, error: true, text: result.error, key: result.message });
          }
          await load(true);
        } finally {
          actionLock.current = false;
          if (!signal.aborted) {
            setPending(null);
            if (focusTarget) window.requestAnimationFrame(() => { if (!signal.aborted) focusTarget.focus(); });
          }
        }
      }
      const feedback = notice && { error: notice.error, text: notice.text || t(notice.key) };
      return h('section', { className: 'dsa-panel', 'aria-labelledby': heading }, h('style', null, styles),
        h('div', { className: 'dsa-inner' },
          h('header', { className: 'dsa-head' },
            h('h1', { id: heading }, t('title')),
            h('p', { className: 'dsa-subtle' }, t('intro')),
            h('p', { className: 'dsa-meta' }, t('privacy')),
            h('div', { className: 'dsa-toolbar' },
              h('button', { type: 'button', ref: addButton, className: 'dsa-primary', disabled: Boolean(pending) || !hasProvider, onClick: event => begin('add', undefined, event.currentTarget) }, t('add')),
              h(Button, { disabled: Boolean(pending) || !accounts.some(account => available[account.provider] && !account.busy && account.provider === 'codex' && account.status === 'ready'), onClick: () => run('refresh') }, t('refreshAll'))),
            snapshot && !hasProvider && h('p', { className: 'dsa-meta dsa-warn' }, t('noProviders'))),
          edit?.kind === 'add' && h(Editor, { key: 'add', kind: 'add', available, pending: Boolean(pending), onSubmit: run, onClose: () => close(), t }),
          pending && pending.id === undefined && h('p', { role: 'status', className: 'dsa-subtle' }, t(progress[pending.action])),
          feedback && notice.id === undefined && h('p', { className: `dsa-note${feedback.error ? ' dsa-error' : ''}`, role: feedback.error ? 'alert' : 'status' }, feedback.text),
          listError && h('div', { className: 'dsa-message dsa-head' },
            h('p', { role: 'alert', className: 'dsa-error dsa-note' }, `${t(snapshot ? 'staleList' : 'listError')} ${listError.text || t(listError.key)}`),
            h('div', null, h(Button, { disabled: Boolean(pending), onClick: () => load(true) }, t('retry')))),
          h('section', { className: 'dsa-list', 'aria-labelledby': listHeading },
            h('h2', { id: listHeading }, t('accounts')),
            !snapshot && !listError && h('p', { role: 'status', className: 'dsa-subtle' }, t('loading')),
            snapshot && accounts.length === 0 && h('div', { className: 'dsa-message dsa-head' }, h('strong', null, t('empty')), h('p', { className: 'dsa-subtle' }, t('emptyHelp'))),
            accounts.map(account => h(Account, {
              account, available, key: account.id, t, pending, begin, close: () => close(), run, focusTarget: added && (!requested || added.at >= requested.at) ? added : requested,
              edit: edit?.id === account.id ? edit : null,
              notice: notice?.id === account.id ? feedback : null,
            })))));
    }

    return {
      inject: ['slots', 'locale', 'layout', 'sessions', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { ru, en, zh: en }), 'subscription agents: locale');
        const t = ctx.locale.bind(NS);
        let panelTarget;
        const listeners = new Set();
        const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
        const getTarget = () => panelTarget;
        const usePanelTarget = () => React.useSyncExternalStore(subscribe, getTarget);
        const openPanel = id => {
          panelTarget = { id, at: Date.now() };
          for (const listener of listeners) listener();
          ctx.layout.selectPanel(PANEL);
        };
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL, locale: NS, inject: () => ({ usePanelTarget }),
        }, Panel));

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: `${PANEL}.usage`, locale: NS, inject: () => ({ openPanel }),
        }, SidebarUsage));
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL, order: 80, label: () => t('panel'), locale: NS,
        }, PanelIcon));
      },
    };
  },
});

(() => {
    'use strict';
    const KEY = 'infinitools-privacy-v1';
    const VERSION = 1;
    const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
    let adsLoaded = false;
    let current = readChoice();
    let returnFocus = null;
    const gpc = navigator.globalPrivacyControl === true;

    function readChoice() {
        try {
            const value = JSON.parse(localStorage.getItem(KEY));
            const age = Date.now() - value?.updatedAt;
            return value?.version === VERSION && typeof value.advertising === 'boolean' && Number.isFinite(age) && age >= 0 && age < MAX_AGE ? value : null;
        } catch { return null; }
    }
    function loadAds() {
        if (adsLoaded || gpc || !current?.advertising) return;
        adsLoaded = true;
        const script = document.createElement('script');
        script.async = true;
        script.crossOrigin = 'anonymous';
        script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2690331521813075';
        script.id = 'infinitools-adsense';
        document.head.append(script);
    }
    const panel = document.createElement('section');
    panel.className = 'privacy-consent';
    panel.setAttribute('aria-label', 'Preferências de privacidade');
    panel.innerHTML = `<div class="privacy-consent-copy"><h2>Você escolhe sobre publicidade</h2><p>Com sua autorização, carregamos o Google AdSense, que pode usar cookies e identificadores para exibir, personalizar e medir anúncios. Rejeitar mantém as ferramentas disponíveis sem carregar esse serviço.</p><p><a href="privacidade">Leia a Política de Privacidade</a>. As escolhas regionais do Google podem ser solicitadas depois.</p><p class="privacy-consent-signal" hidden>Seu navegador enviou um sinal de privacidade (GPC). A publicidade permanecerá bloqueada.</p></div><div class="privacy-consent-actions"><button type="button" data-privacy-reject>Rejeitar publicidade</button><button type="button" data-privacy-accept>Aceitar publicidade</button><button type="button" data-privacy-manage>Gerenciar preferências</button></div>`;
    document.body.append(panel);
    const dialog = document.createElement('dialog');
    dialog.className = 'privacy-preferences';
    dialog.setAttribute('aria-labelledby', 'privacyPreferencesTitle');
    dialog.innerHTML = `<h2 id="privacyPreferencesTitle">Preferências de privacidade</h2><p>As ferramentas continuam disponíveis independentemente da sua escolha.</p><div class="privacy-category"><strong>Funcionamento e segurança — sempre ativos</strong><p>Sessões necessárias, configurações e recuperação de edição. Este controle não apaga seus projetos ou configurações locais.</p></div><div class="privacy-category"><label><input type="checkbox" id="privacyAdvertising"> Permitir publicidade do Google</label><p>Autoriza carregar o Google AdSense e seus recursos de publicidade. As escolhas adicionais da CMP do Google continuam valendo nas regiões aplicáveis.</p></div><p>Ao desativar publicidade já carregada, precisamos recarregar a página. Salve ou exporte seu trabalho antes de confirmar. Isso bloqueia novos carregamentos; não apaga dados que já tenham sido enviados ao Google.</p><p><a href="privacidade">Política de Privacidade</a></p><div class="privacy-consent-actions"><button type="button" data-privacy-save>Salvar preferências</button><button type="button" data-privacy-close>Cancelar</button></div>`;
    document.body.append(dialog);
    const checkbox = dialog.querySelector('#privacyAdvertising');
    checkbox.disabled = gpc;
    panel.querySelector('.privacy-consent-signal').hidden = !gpc;
    panel.querySelector('[data-privacy-accept]').disabled = gpc;

    function saveChoice(advertising) {
        advertising = advertising && !gpc;
        if (!advertising && adsLoaded && !window.confirm('A página será recarregada para interromper a publicidade. Edições não salvas podem ser perdidas. Já salvou seu trabalho e deseja continuar?')) return;
        current = {version: VERSION, advertising, updatedAt: Date.now()};
        try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* A escolha vale nesta página mesmo sem armazenamento disponível. */ }
        panel.hidden = true;
        if (dialog.open) dialog.close();
        if (!advertising && adsLoaded) { window.location.reload(); return; }
        loadAds();
    }
    function openPreferences() {
        checkbox.checked = !gpc && current?.advertising === true;
        returnFocus = document.activeElement;
        dialog.showModal();
        checkbox.focus();
    }
    panel.querySelector('[data-privacy-accept]').addEventListener('click', () => saveChoice(true));
    panel.querySelector('[data-privacy-reject]').addEventListener('click', () => saveChoice(false));
    panel.querySelector('[data-privacy-manage]').addEventListener('click', openPreferences);
    dialog.querySelector('[data-privacy-save]').addEventListener('click', () => saveChoice(checkbox.checked));
    dialog.querySelector('[data-privacy-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => returnFocus?.focus());
    document.querySelectorAll('[data-privacy-preferences]').forEach(button => {
        button.hidden = false;
        button.addEventListener('click', openPreferences);
    });
    // A escolha de outra aba será respeitada na próxima navegação. Nunca
    // recarregar um editor automaticamente e perder trabalho não salvo.
    window.addEventListener('storage', event => {
        if (event.key !== KEY) return;
        current = readChoice();
        panel.hidden = false;
        if (adsLoaded && !current?.advertising) {
            panel.querySelector('h2').textContent = 'Preferências alteradas em outra aba';
            panel.querySelector('.privacy-consent-copy p').textContent = 'Salve seu trabalho e clique em Rejeitar publicidade para recarregar esta página e interromper o serviço já carregado.';
        }
    });
    if (gpc) {
        if (current?.advertising) saveChoice(false);
        panel.hidden = !!current;
    } else {
        panel.hidden = !!current;
        loadAds();
    }
})();

(function () {
  'use strict';

  var root = document.documentElement;

  /* =====================================================================
     Language: English / Arabic
     English text lives in the page itself; Arabic strings are below. The
     choice is remembered, and Arabic switches the whole page right-to-left.
     ===================================================================== */

  var AR = {
    home: 'الصفحة الرئيسية لسبلاش كار',
    contact: 'تواصل معنا',
    title: 'قيد <span>الإنشاء</span>',
    sub: 'شيء جديد في الطريق. ترقّبوا.',
    scroll: 'انتقل إلى التواصل',
    eyebrow: 'ابقَ على اطلاع',
    heading: 'الأشياء الجميلة<br />تبدأ<br /><span>بمحادثة.</span>',
    intro: 'لديك سؤال أو تريد معرفة ما هو قادم؟<br class="desktop" /> يسعدنا أن نسمع منك.',
    platform: 'منصة من مجموعة ليفانتا',
    name: 'الاسم',
    namePh: 'اسمك',
    email: 'البريد الإلكتروني',
    message: 'الرسالة',
    messagePh: 'كيف يمكننا مساعدتك؟',
    optin: 'اشترك في قائمتنا البريدية لتصلك التحديثات والعروض والمزيد.',
    send: 'إرسال',
    sending: 'جارٍ الإرسال…',
    thanks: 'شكرًا لك، سنتواصل معك قريبًا.',
    retry: 'يُرجى المحاولة مرة أخرى.',
    terms: 'الشروط والأحكام',
    privacy: 'سياسة الخصوصية',
    tagline: 'العناية بالسيارات. رحلة أنظف في الطريق.'
  };
  var EN_EXTRA = { sending: 'Sending…', thanks: 'Thanks — we’ll be in touch soon.', retry: 'Please try again.' };

  // Remember each element's English text so switching back restores it exactly
  var nodes = [];
  [['data-i18n', 'text'], ['data-i18n-html', 'html'], ['data-i18n-ph', 'ph'], ['data-i18n-aria', 'aria']].forEach(function (pair) {
    document.querySelectorAll('[' + pair[0] + ']').forEach(function (el) {
      var kind = pair[1];
      var en = kind === 'text' ? el.textContent : kind === 'html' ? el.innerHTML : kind === 'ph' ? el.placeholder : el.getAttribute('aria-label');
      nodes.push({ el: el, kind: kind, key: el.getAttribute(pair[0]), en: en });
    });
  });

  var lang = root.lang === 'ar' ? 'ar' : 'en';
  function t(key) { return lang === 'ar' ? AR[key] : EN_EXTRA[key]; }

  function applyLang(next) {
    lang = next;
    root.lang = next;
    root.dir = next === 'ar' ? 'rtl' : 'ltr';
    nodes.forEach(function (n) {
      var v = next === 'ar' && AR[n.key] != null ? AR[n.key] : n.en;
      if (n.kind === 'text') n.el.textContent = v;
      else if (n.kind === 'html') n.el.innerHTML = v; // fixed strings from this file or the page
      else if (n.kind === 'ph') n.el.placeholder = v;
      else n.el.setAttribute('aria-label', v);
    });
    document.querySelectorAll('.lang-switch [data-lang]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.lang === next));
    });
    try { localStorage.setItem('splash-lang', next); } catch (e) {}
  }

  document.querySelectorAll('.lang-switch [data-lang]').forEach(function (b) {
    b.addEventListener('click', function () { applyLang(b.dataset.lang); });
  });
  applyLang(lang);

  /* =====================================================================
     Review panel (?review in the URL): switch direction and title wording
     ===================================================================== */

  var params = new URLSearchParams(location.search);
  var review = document.querySelector('.review');
  if (params.has('review')) {
    review.hidden = false;
    var dirButtons = review.querySelectorAll('[data-direction]');
    var syncDir = function () {
      dirButtons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.direction === root.dataset.theme)); });
    };
    dirButtons.forEach(function (b) {
      b.addEventListener('click', function () {
        root.dataset.theme = b.dataset.direction;
        params.set('direction', b.dataset.direction);
        history.replaceState(null, '', '?' + params.toString().replace('review=', 'review') + location.hash);
        syncDir();
      });
    });
    syncDir();

    var title = document.getElementById('hero-title');
    review.querySelector('.review-title-select').addEventListener('change', function (e) {
      title.innerHTML = e.target.value; // values are fixed strings in index.html
    });
  }

  /* =====================================================================
     Contact form
     ===================================================================== */

  var form = document.querySelector('.contact-form');
  var status = form.querySelector('.form-status');
  var sendBtn = form.querySelector('.send');
  var sendLabel = form.querySelector('.send-label');

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (sendBtn.disabled) return;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    var data = new FormData(form);
    sendBtn.disabled = true;
    sendLabel.textContent = t('sending');
    status.className = 'form-status';
    status.textContent = '';
    try {
      var res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'),
          email: data.get('email'),
          message: data.get('message'),
          emailOptIn: data.get('emailOptIn') === 'on',
          website: data.get('website')
        })
      });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(body.error || t('retry'));
      status.textContent = t('thanks');
      form.reset();
    } catch (err) {
      status.className = 'form-status error';
      status.textContent = err.message || t('retry');
    } finally {
      sendBtn.disabled = false;
      sendLabel.textContent = lang === 'ar' ? AR.send : 'Send';
    }
  });
})();

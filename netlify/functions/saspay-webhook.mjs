// Webhook SasPay -> e-mails de confirmation d'inscription (Brevo)
// URL à déclarer dans SasPay : https://blinky.digital/.netlify/functions/saspay-webhook
// Variables Netlify (Site configuration > Environment variables) :
//   BREVO_API_KEY            clé API Brevo (obligatoire)
//   EMAIL_EXPEDITEUR         adresse validée dans Brevo (par défaut blinkyacademy@gmail.com)
//   EMAIL_CELLULE_FORMATION  destinataire interne (par défaut blinkyacademy@gmail.com)
//   SASPAY_WEBHOOK_SECRET    secret de signature SasPay (optionnel, recommandé)

import crypto from 'node:crypto';

const FORMATION = 'Formation E-commerce Afrique';

// Cherche une valeur dans l'objet reçu, quel que soit l'emplacement (data.object.customer.email, etc.)
function trouver(obj, cles, profondeur = 0) {
  if (!obj || typeof obj !== 'object' || profondeur > 5) return undefined;
  for (const k of cles) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  for (const v of Object.values(obj)) {
    const r = trouver(v, cles, profondeur + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

function signatureValide(corps, entetes) {
  const secret = process.env.SASPAY_WEBHOOK_SECRET;
  if (!secret) return true;
  const recue = entetes.get('x-saspay-signature') || entetes.get('saspay-signature') || entetes.get('x-signature') || '';
  const attendue = crypto.createHmac('sha256', secret).update(corps).digest('hex');
  const candidates = recue.split(/[,= ]/).filter(Boolean);
  return candidates.some(c => c.length === attendue.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(attendue)));
}

async function envoyer({ to, toName, subject, html }) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: 'Blinky Academy', email: process.env.EMAIL_EXPEDITEUR || 'blinkyacademy@gmail.com' },
      to: [{ email: to, name: toName || undefined }],
      subject, htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error('Brevo ' + r.status + ' ' + (await r.text()));
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async (req) => {
  if (req.method !== 'POST') return new Response('ok', { status: 200 });
  const corps = await req.text();
  if (!signatureValide(corps, req.headers)) return new Response('signature invalide', { status: 401 });

  let ev; try { ev = JSON.parse(corps); } catch { return new Response('json invalide', { status: 400 }); }

  const type = String(trouver(ev, ['type', 'event', 'event_type']) || '').toLowerCase();
  const statut = String(trouver(ev, ['status', 'payment_status']) || '').toLowerCase();
  const paye = /(succeed|success|paid|complete|captur)/.test(type + ' ' + statut);
  if (!paye) return new Response('ignoré', { status: 200 });

  const email = trouver(ev, ['email', 'customer_email', 'payer_email']);
  const prenom = trouver(ev, ['first_name', 'firstname', 'prenom']) || '';
  const nom = trouver(ev, ['last_name', 'lastname', 'nom']) || '';
  const montant = trouver(ev, ['amount', 'amount_total', 'montant']);
  const devise = String(trouver(ev, ['currency', 'devise']) || 'XOF').toUpperCase();
  const ref = trouver(ev, ['reference', 'payment_id', 'id']) || '';
  const nomComplet = (prenom + ' ' + nom).trim();

  const cellule = process.env.EMAIL_CELLULE_FORMATION || 'blinkyacademy@gmail.com';
  const style = 'font-family:Arial,sans-serif;color:#111;line-height:1.6;max-width:560px';

  if (email) {
    await envoyer({
      to: email, toName: nomComplet,
      subject: `✅ Ton inscription à la ${FORMATION} est confirmée`,
      html: `<div style="${style}">
        <p>Bonjour ${esc(prenom) || ''},</p>
        <p>Ton paiement est bien reçu : <b>ton inscription à la ${FORMATION} est confirmée</b>. Bienvenue dans Blinky Academy !</p>
        <p><b>📅 Dates :</b> samedi 5 et dimanche 6 décembre 2026<br>
        <b>💻 Format :</b> 100 % en ligne, en direct<br>
        <b>💳 Montant payé :</b> ${esc(montant ?? '')} ${esc(devise)}</p>
        <p>Tu recevras le lien de connexion et le programme détaillé avant le début de la formation.
        Une question ? Écris-nous sur WhatsApp : <a href="https://wa.me/221771040233">+221 77 104 02 33</a>.</p>
        <p>À très vite,<br>Mbagnick Seck<br>Blinky Academy · Apprends. Applique. Évolue.</p></div>`,
    });
  }

  await envoyer({
    to: cellule,
    subject: `🎉 Nouvelle inscription : ${nomComplet || email || 'client'} (${FORMATION})`,
    html: `<div style="${style}">
      <p><b>Nouvelle inscription payée</b> à la ${FORMATION} (5 et 6 décembre 2026).</p>
      <p><b>Nom :</b> ${esc(nomComplet) || '—'}<br><b>E-mail :</b> ${esc(email) || '—'}<br>
      <b>Montant :</b> ${esc(montant ?? '—')} ${esc(devise)}<br><b>Référence :</b> ${esc(ref) || '—'}</p>
      <p>${email ? "Un e-mail de confirmation a été envoyé au client." : "⚠️ Aucun e-mail client reçu de SasPay : contacte-le manuellement."}</p></div>`,
  });

  return new Response('ok', { status: 200 });
};

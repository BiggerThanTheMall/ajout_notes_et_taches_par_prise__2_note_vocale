// ==UserScript==
// @name         Modulr - Assistant Vocal Ajout de Notes et Taches
// @version      9.8.4
// @description  Lu'itilisateur peut ajouter des note et taches modulr en dictant oralement 
// @match        https://courtage.modulr.fr/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      generativelanguage.googleapis.com
// @updateURL    https://raw.githubusercontent.com/BiggerThanTheMall/ajout_notes_et_taches_par_prise__2_note_vocale/main/ajout_note_et_tache_vocale.user.js
// @downloadURL  https://raw.githubusercontent.com/BiggerThanTheMall/ajout_notes_et_taches_par_prise__2_note_vocale/main/ajout_note_et_tache_vocale.user.js
// ==/UserScript==

(function() {
    'use strict';

    const GEMINI_MODELS = [
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
    ];

    function getClientContext() {
        const name = document.querySelector('.vcard_name')?.innerText || "";
        return name ? `CLIENT : ${name}` : "";
    }

    async function callGemini(text, modelIndex = 0) {
        let apiKey = GM_getValue('gemini_api_key', '');
        if (!apiKey) return alert("Configurez la clé API (roue crantée).");

        const model = GEMINI_MODELS[modelIndex];
        if (!model) throw new Error("Aucun modèle n'a répondu.");

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        // Prompt strict pour éviter le bavardage et imposer ta structure
        const promptTxt = `Tu es un assistant expert en courtage.
        ${getClientContext()}

        MISSION : Reformule cette dictée vocale.
        RÈGLES STRICTES :
        1. NE DIS RIEN AVANT LE TEXTE (pas de "Voici le texte", pas de titre).
        2. Écris d'abord le compte-rendu de l'échange de manière fluide et professionnelle.
        3. Saute deux lignes.
        4. Ajoute ensuite exactement ces rubriques en MAJUSCULES :
           SITUATION ACTUELLE :
           ACTIONS MENÉES :
           PROCHAINES ÉTAPES :

        DICTÉE À TRAITER : "${text}"`;

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify({
                    contents: [{ parts: [{ text: promptTxt }] }],
                    generationConfig: { temperature: 0.1 } // Basse température pour éviter les phrases inutiles
                }),
                timeout: 8000,
                onload: async function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.error) {
                            if (modelIndex < GEMINI_MODELS.length - 1) resolve(await callGemini(text, modelIndex + 1));
                            else reject(new Error(data.error.message));
                        } else if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                            let result = data.candidates[0].content.parts[0].text;
                            // Nettoyage final pour virer les éventuels résidus de Markdown (étoiles, dièses)
                            resolve(result.replace(/[\*\#]/g, '').trim());
                        } else { reject(new Error("Réponse vide.")); }
                    } catch (e) { reject(e); }
                },
                onerror: () => reject(new Error("Erreur réseau.")),
                ontimeout: async () => {
                   if (modelIndex < GEMINI_MODELS.length - 1) resolve(await callGemini(text, modelIndex + 1));
                   else reject(new Error("Timeout."));
                }
            });
        });
    }

    function injectInterface() {
        const target = document.getElementById('task_note');
        if (!target || document.getElementById('vocal-wrapper')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'vocal-wrapper';
        wrapper.style = "background:#f4f7f9; border:1px solid #ced4da; padding:10px; margin-bottom:10px; border-radius:6px; display:flex; flex-direction:column; gap:8px;";

        wrapper.innerHTML = `
            <div style="display:flex; gap:10px; align-items:center;">
                <button type="button" id="v-start" style="background:#28a745; color:white; border:none; padding:8px 15px; border-radius:4px; cursor:pointer; font-weight:bold;">🎤 Dictée</button>
                <button type="button" id="v-stop" style="display:none; background:#dc3545; color:white; border:none; padding:8px 15px; border-radius:4px; cursor:pointer; font-weight:bold;">🛑 Stop</button>
                <button type="button" id="v-clean" style="background:#007bff; color:white; border:none; padding:8px 15px; border-radius:4px; cursor:pointer; font-weight:bold;">✨ Reformuler</button>
                <button type="button" id="v-settings" style="background:#6c757d; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">⚙️</button>
            </div>
            <div id="v-preview" style="font-size:11px; color:#666; font-style:italic;">Prêt pour la saisie...</div>
        `;

        target.parentNode.insertBefore(wrapper, target);
        const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.lang = 'fr-FR';
        recognition.continuous = true;
        recognition.interimResults = true;

        wrapper.querySelector('#v-settings').onclick = () => {
            let k = prompt("Clé API Gemini :", GM_getValue('gemini_api_key', ''));
            if (k) GM_setValue('gemini_api_key', k.trim());
        };

        wrapper.querySelector('#v-start').onclick = () => { recognition.start(); toggleUI(true); };
        wrapper.querySelector('#v-stop').onclick = () => { recognition.stop(); toggleUI(false); };

        wrapper.querySelector('#v-clean').onclick = async () => {
            const btn = wrapper.querySelector('#v-clean');
            const preview = document.getElementById('v-preview');
            if (!target.value) return;

            btn.disabled = true;
            btn.innerText = "⏳ Reformulation...";
            preview.innerText = "Traitement intelligent en cours...";

            try {
                const result = await callGemini(target.value);
                target.value = result;
                preview.innerText = "✅ Note mise à jour.";
            } catch (e) {
                preview.innerText = "❌ Erreur : " + e.message;
            } finally {
                btn.disabled = false;
                btn.innerText = "✨ Reformuler";
            }
        };

        recognition.onresult = (e) => {
            let res = '';
            for (let i = e.resultIndex; i < e.results.length; ++i) {
                if (e.results[i].isFinal) target.value += (target.value ? " " : "") + e.results[i][0].transcript;
                else res += e.results[i][0].transcript;
            }
            document.getElementById('v-preview').innerText = "Dictée : " + res;
        };
    }

    function toggleUI(on) {
        document.getElementById('v-start').style.display = on ? 'none' : 'inline-block';
        document.getElementById('v-stop').style.display = on ? 'inline-block' : 'none';
        if(on) document.getElementById('v-preview').innerText = "🔴 Écoute active...";
    }

    const observer = new MutationObserver(() => injectInterface());
    observer.observe(document.body, { childList: true, subtree: true });

})();

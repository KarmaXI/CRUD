// == crudBasis.js ==
// Versie met ondersteuning voor het specificeren van een doel-site URL
// en verbeterde foutafhandeling.

/**
 * Haalt de Form Digest Value (Request Digest) op voor een specifieke site URL.
 * @param {string} siteUrl - De absolute URL van de SharePoint site.
 * @returns {Promise<string>} Een Promise die wordt opgelost met de Request Digest string.
 * @throws {Error} Als de siteUrl niet is opgegeven.
 */
function verkrijgRequestDigestVoorSite(siteUrl) {
    if (!siteUrl) {
        return Promise.reject(new Error("Site URL is vereist voor verkrijgRequestDigestVoorSite."));
    }
    // De REST endpoint om context informatie (inclusief de digest) op te halen voor de *specifieke* site.
    const eindpuntUrl = siteUrl.replace(/\/$/, '') + "/_api/contextinfo";
    console.log(`%cRequest Digist opgehaald van site: ${eindpuntUrl}`, "color:white; background-color:green");

    return fetch(eindpuntUrl, {
        method: "POST",
        headers: {
            "Accept": "application/json;odata=verbose"
        }
    })
    .then(antwoord => {
        if (!antwoord.ok) {
             return antwoord.json().catch(() => {
                // Als JSON parsen mislukt, gooi een fout met de status
                throw new Error(`HTTP fout ${antwoord.status} bij ophalen Request Digest van ${eindpuntUrl}`);
             }).then(foutData => {
                // Probeer een gedetailleerde foutmelding te maken
                let foutMelding = `HTTP fout ${antwoord.status} bij ophalen Request Digest van ${eindpuntUrl}`;
                if (foutData && foutData.error && foutData.error.message && foutData.error.message.value) {
                   foutMelding += ` - ${foutData.error.message.value}`;
                }
                throw new Error(foutMelding);
            });
        }
        return antwoord.json();
    })
    .then(data => {
        if (data && data.d && data.d.GetContextWebInformation && data.d.GetContextWebInformation.FormDigestValue) {
            const requestDigest = data.d.GetContextWebInformation.FormDigestValue;
            console.log(`Request Digest verkregen voor ${siteUrl}.`);
            return requestDigest;
        } else {
            throw new Error(`Kon FormDigestValue niet vinden in het antwoord van ${eindpuntUrl}.`);
        }
    })
    .catch(fout => {
        console.error(`Fout bij ophalen Request Digest voor ${siteUrl}:`, fout);
        // Gooi de fout opnieuw door zodat de aanroepende functie deze kan afhandelen
        throw fout;
    });
}


/**
 * Voert een generiek GET-verzoek uit naar een specifieke SharePoint REST API-endpoint op een bepaalde site.
 * @param {string} siteUrl - De absolute URL van de doel SharePoint site.
 * @param {string} specifiekeEndpoint - De specifieke REST API endpoint relatief aan de siteUrl (bijv. "_api/web/lists/...").
 * @returns {Promise<object|null>} Een Promise die wordt opgelost met de geparste JSON-data of null bij succes.
 * @throws {Error} Als de siteUrl niet is opgegeven.
 */
function haalGegevensOp(siteUrl, specifiekeEndpoint) {
     if (!siteUrl) {
        return Promise.reject(new Error("Site URL is vereist voor haalGegevensOp."));
    }
    // Bouw de volledige URL correct op.
    const volledigeEindpuntUrl = siteUrl.replace(/\/$/, '') + '/' + specifiekeEndpoint.replace(/^\//, '');
    console.log(`Uitvoeren GET-verzoek naar: ${volledigeEindpuntUrl}`);

    return fetch(volledigeEindpuntUrl, {
        method: "GET",
        headers: {
            "Accept": "application/json;odata=verbose",
        }
    })
    .then(antwoord => {
        if (!antwoord.ok) {
            // Poging om meer details uit de fout te halen
            return antwoord.json().catch(() => {
                 throw new Error(`HTTP fout ${antwoord.status} bij GET ${volledigeEindpuntUrl}`);
            }).then(foutData => {
                let foutMelding = `HTTP fout ${antwoord.status} bij GET ${volledigeEindpuntUrl}`;
                if (foutData && foutData.error && foutData.error.message && foutData.error.message.value) {
                   foutMelding += ` - ${foutData.error.message.value}`;
                }
                throw new Error(foutMelding);
            });
        }
        if (antwoord.status === 204) { // No Content
            return null;
        }
        return antwoord.json(); // Parse JSON bij succes (bv. 200 OK)
    })
    .then(data => {
        console.log(`GET-verzoek naar ${volledigeEindpuntUrl} succesvol uitgevoerd.`);
        return data; // Retourneer de data (kan null zijn)
    })
    .catch(fout => {
        console.error(`Fout tijdens GET-operatie naar ${volledigeEindpuntUrl}:`, fout);
        throw fout; // Gooi fout opnieuw door
    });
}

/**
 * Voert een POST-verzoek uit om een nieuw item aan een SharePoint-lijst toe te voegen op een specifieke site.
 * @param {string} siteUrl - De absolute URL van de doel SharePoint site.
 * @param {string} lijstNaam - De titel van de SharePoint-lijst.
 * @param {object} itemData - Een object met de kolomnamen (interne namen!) en waarden.
 * @param {string} lijstItemEntityType - De exacte ListItemEntityTypeFullName (vereist!).
 * @returns {Promise<object>} Een Promise die wordt opgelost met de data van het nieuw aangemaakte item.
 * @throws {Error} Als siteUrl of lijstItemEntityType niet is opgegeven.
 */
function voegItemToe(siteUrl, lijstNaam, itemData, lijstItemEntityType) {
     if (!siteUrl) { return Promise.reject(new Error("Site URL is vereist voor voegItemToe.")); }
     if (!lijstItemEntityType) { return Promise.reject(new Error(`ListItemEntityType is vereist voor het toevoegen aan lijst '${lijstNaam}'.`)); }

     const dataVoorVerzoek = { ...itemData, __metadata: { 'type': lijstItemEntityType } };
     const lijstItemsUrl = `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${encodeURIComponent(lijstNaam)}')/items`;

     // Haal eerst de Request Digest voor de *doel site* op.
     return verkrijgRequestDigestVoorSite(siteUrl)
         .then(requestDigest => {
             console.log(`Voorbereiden POST-verzoek naar: ${lijstItemsUrl}`);
             return fetch(lijstItemsUrl, {
                 method: "POST",
                 headers: {
                     "Accept": "application/json;odata=verbose",
                     "Content-Type": "application/json;odata=verbose",
                     "X-RequestDigest": requestDigest
                 },
                 body: JSON.stringify(dataVoorVerzoek)
             });
         })
         .then(antwoord => {
             if (!antwoord.ok || antwoord.status !== 201) {
                  return antwoord.json().catch(() => {
                     throw new Error(`HTTP fout ${antwoord.status} bij POST naar ${lijstItemsUrl}`);
                  }).then(foutData => {
                     let foutMelding = `HTTP fout ${antwoord.status} bij POST naar lijst '${lijstNaam}' op ${siteUrl}`;
                     if (foutData && foutData.error && foutData.error.message && foutData.error.message.value) {
                        foutMelding += ` - ${foutData.error.message.value}`;
                     }
                     throw new Error(foutMelding);
                 });
             }
             console.log("POST-verzoek succesvol (Status: 201 Created).");
             return antwoord.json();
         })
         .then(data => {
             console.log("Nieuw item succesvol toegevoegd:", data.d || data);
             return data; // Retourneer het volledige antwoord (vaak met .d)
         })
         .catch(fout => {
             console.error(`Fout tijdens POST-operatie naar lijst '${lijstNaam}' op ${siteUrl}:`, fout);
             throw fout;
         });
 }


/**
 * Voert een MERGE-verzoek uit om een bestaand item in een SharePoint-lijst bij te werken op een specifieke site.
 * @param {string} siteUrl - De absolute URL van de doel SharePoint site.
 * @param {string} lijstNaam - De titel van de SharePoint-lijst.
 * @param {number} itemId - De ID van het item dat bijgewerkt moet worden.
 * @param {object} itemData - Een object met de kolomnamen (interne namen!) en de *nieuwe* waarden.
 * @param {string} lijstItemEntityType - De exacte ListItemEntityTypeFullName (vereist!).
 * @returns {Promise<void>} Een Promise die wordt opgelost bij succes.
 * @throws {Error} Als siteUrl of lijstItemEntityType niet is opgegeven.
 */
function werkItemBij(siteUrl, lijstNaam, itemId, itemData, lijstItemEntityType) {
    if (!siteUrl) { return Promise.reject(new Error("Site URL is vereist voor werkItemBij.")); }
    if (!lijstItemEntityType) { return Promise.reject(new Error(`ListItemEntityType is vereist voor het bijwerken van item ${itemId} in lijst '${lijstNaam}'.`)); }

    const dataVoorVerzoek = { ...itemData, __metadata: { 'type': lijstItemEntityType } };
    const itemUrl = `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${encodeURIComponent(lijstNaam)}')/items(${itemId})`;

    return verkrijgRequestDigestVoorSite(siteUrl)
        .then(requestDigest => {
            console.log(`Voorbereiden MERGE-verzoek naar: ${itemUrl}`);
            return fetch(itemUrl, {
                method: "POST",
                headers: {
                    "Accept": "application/json;odata=verbose",
                    "Content-Type": "application/json;odata=verbose",
                    "X-RequestDigest": requestDigest,
                    "IF-MATCH": "*", // Overschrijf altijd (of gebruik ETag)
                    "X-HTTP-Method": "MERGE"
                },
                body: JSON.stringify(dataVoorVerzoek)
            });
        })
        .then(antwoord => {
            if (!antwoord.ok || antwoord.status !== 204) { // Verwacht 204 No Content
                 return antwoord.text().then(text => { // Probeer tekst te lezen, JSON is niet gegarandeerd
                    let foutMelding = `HTTP fout ${antwoord.status} bij MERGE voor item ${itemId} op ${itemUrl}`;
                    if (text) foutMelding += ` - Response: ${text}`;
                    throw new Error(foutMelding);
                 }).catch(parseError => { // Als .text() ook faalt
                     throw new Error(`HTTP fout ${antwoord.status} bij MERGE voor item ${itemId} op ${itemUrl}. Kon response niet lezen: ${parseError.message}`);
                 });
            }
            console.log(`Item ${itemId} succesvol bijgewerkt (Status: 204 No Content).`);
            return; // Succes, geen data
        })
        .catch(fout => {
            console.error(`Fout tijdens MERGE-operatie voor item ${itemId} op ${siteUrl}:`, fout);
            throw fout;
        });
}


/**
 * Voert een DELETE-verzoek uit om een item uit een SharePoint-lijst te verwijderen op een specifieke site.
 * @param {string} siteUrl - De absolute URL van de doel SharePoint site.
 * @param {string} lijstNaam - De titel van de SharePoint-lijst.
 * @param {number} itemId - De ID van het item dat verwijderd moet worden.
 * @returns {Promise<void>} Een Promise die wordt opgelost bij succes.
 * @throws {Error} Als siteUrl niet is opgegeven.
 */
function verwijderItem(siteUrl, lijstNaam, itemId) {
    if (!siteUrl) { return Promise.reject(new Error("Site URL is vereist voor verwijderItem.")); }

    const itemUrl = `${siteUrl.replace(/\/$/, '')}/_api/web/lists/getbytitle('${encodeURIComponent(lijstNaam)}')/items(${itemId})`;

    return verkrijgRequestDigestVoorSite(siteUrl)
        .then(requestDigest => {
            console.log(`Voorbereiden DELETE-verzoek naar: ${itemUrl}`);
            return fetch(itemUrl, {
                method: "POST",
                headers: {
                    "Accept": "application/json;odata=verbose",
                    "X-RequestDigest": requestDigest,
                    "IF-MATCH": "*",
                    "X-HTTP-Method": "DELETE"
                }
            });
        })
        .then(antwoord => {
            // Verwacht 200 OK of 204 No Content
            if (!antwoord.ok || (antwoord.status !== 200 && antwoord.status !== 204)) {
                 return antwoord.text().then(text => {
                    let foutMelding = `HTTP fout ${antwoord.status} bij DELETE voor item ${itemId} op ${itemUrl}`;
                    if (text) foutMelding += ` - Response: ${text}`;
                    throw new Error(foutMelding);
                 }).catch(parseError => {
                     throw new Error(`HTTP fout ${antwoord.status} bij DELETE voor item ${itemId} op ${itemUrl}. Kon response niet lezen: ${parseError.message}`);
                 });
            }
            console.log(`Item ${itemId} succesvol verwijderd (Status: ${antwoord.status}).`);
            return; // Succes, geen data
        })
        .catch(fout => {
            console.error(`Fout tijdens DELETE-operatie voor item ${itemId} op ${siteUrl}:`, fout);
            throw fout;
        });
}

// == Einde crudBasis.js ==

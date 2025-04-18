// SPListConfigService.jsx
// Centrale configuratieservice voor SharePoint CRUD-operaties

import * as React from 'react';

/**
 * SharePoint lijst configuratieservice 
 * Verantwoordelijk voor alle CRUD-operaties op SharePoint lijsten
 */
class SPListConfigService {
  constructor() {
    // Basis configuratie
    this.siteUrl = _spPageContextInfo.webAbsoluteUrl;
    this.apiVersion = "1.0";
    this.requestDigest = document.getElementById("__REQUESTDIGEST").value;
    this.huidigeSelectie = null; // Houdt de huidige geselecteerde rij bij
    this.activeLijst = null; // Houdt de huidige actieve lijst bij
    this.laatsteOperatie = null; // Houdt de laatste operatie bij voor debugging
    this.debugMode = true; // Schakelt uitgebreide foutmeldingen in/uit
    this.tabelVerversCallbacks = new Map(); // Map voor callback functies om tabellen te verversen
  }

  /**
   * Initialiseert een lijst voor gebruik
   * @param {string} lijstNaam - De naam van de SharePoint lijst
   * @param {function} verversCallback - Callback functie om de tabel te verversen
   * @returns {string} - Lijst ID voor referentie
   */
  initialiseerLijst(lijstNaam, verversCallback) {
    try {
      const lijstId = this._genereerId();
      
      // Sla de ververs callback op
      if (verversCallback && typeof verversCallback === 'function') {
        this.tabelVerversCallbacks.set(lijstId, verversCallback);
      }
      
      this._logInfo(`Lijst ${lijstNaam} geïnitialiseerd met ID: ${lijstId}`);
      return lijstId;
    } catch (fout) {
      this._verwerkFout(fout, "initialiseerLijst", { lijstNaam });
      return null;
    }
  }

  /**
   * Haalt items op uit een SharePoint lijst
   * @param {string} lijstNaam - De naam van de SharePoint lijst
   * @param {string} selectVelden - Komma-gescheiden lijst van velden (of '*' voor alle velden)
   * @param {string} filterQuery - OData filter query
   * @param {string} lijstId - Optionele lijst ID voor verversing
   * @returns {Promise<Array>} - Promise met lijst items
   */
  async haalItemsOp(lijstNaam, selectVelden = "*", filterQuery = "", lijstId = null) {
    try {
      this.activeLijst = lijstNaam;
      let url = `${this.siteUrl}/_api/web/lists/getbytitle('${lijstNaam}')/items`;
      
      // Bouw de query string op
      const queryParams = [];
      if (selectVelden && selectVelden !== "*") {
        queryParams.push(`$select=${selectVelden}`);
      }
      if (filterQuery) {
        queryParams.push(`$filter=${filterQuery}`);
      }
      
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`;
      }
      
      this._logInfo(`API Aanroep: GET ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP fout ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const items = data.d.results;
      
      this._logInfo(`${items.length} items opgehaald uit lijst "${lijstNaam}"`);
      
      // Update laatsteOperatie voor debugging
      this.laatsteOperatie = {
        type: "LEZEN",
        lijst: lijstNaam,
        tijdstempel: new Date().toISOString(),
        itemCount: items.length
      };
      
      return items;
    } catch (fout) {
      this._verwerkFout(fout, "haalItemsOp", { lijstNaam, selectVelden, filterQuery });
      return [];
    }
  }

  /**
   * Voegt een nieuw item toe aan een SharePoint lijst
   * @param {string} lijstNaam - De naam van de SharePoint lijst
   * @param {Object} itemData - De gegevens voor het nieuwe item
   * @param {string} lijstId - Optionele lijst ID voor verversing
   * @returns {Promise<Object>} - Promise met het nieuwe item
   */
  async voegItemToe(lijstNaam, itemData, lijstId = null) {
    try {
      this.activeLijst = lijstNaam;
      const url = `${this.siteUrl}/_api/web/lists/getbytitle('${lijstNaam}')/items`;
      
      this._logInfo(`API Aanroep: POST ${url}`, itemData);
      
      // Zorg ervoor dat we geen ID meesturen (SharePoint wijst deze automatisch toe)
      const schoneData = { ...itemData };
      delete schoneData.Id;
      delete schoneData.id;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose',
          'X-RequestDigest': this.requestDigest
        },
        body: JSON.stringify({ '__metadata': { 'type': `SP.Data.${lijstNaam}ListItem` }, ...schoneData })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP fout ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const nieuwItem = data.d;
      
      this._logInfo(`Nieuw item toegevoegd aan "${lijstNaam}" met ID: ${nieuwItem.Id}`);
      
      // Update laatsteOperatie voor debugging
      this.laatsteOperatie = {
        type: "TOEVOEGEN",
        lijst: lijstNaam,
        tijdstempel: new Date().toISOString(),
        itemId: nieuwItem.Id
      };
      
      // Ververs de tabel indien nodig
      if (lijstId && this.tabelVerversCallbacks.has(lijstId)) {
        this._logInfo(`Tabel verversen voor lijst ${lijstNaam} (ID: ${lijstId})`);
        await this.tabelVerversCallbacks.get(lijstId)();
      }
      
      return nieuwItem;
    } catch (fout) {
      this._verwerkFout(fout, "voegItemToe", { lijstNaam, itemData });
      return null;
    }
  }

  /**
   * Werkt een bestaand item bij in een SharePoint lijst
   * @param {string} lijstNaam - De naam van de SharePoint lijst
   * @param {number} itemId - De ID van het item om bij te werken
   * @param {Object} itemData - De nieuwe gegevens voor het item
   * @param {string} lijstId - Optionele lijst ID voor verversing
   * @returns {Promise<boolean>} - Promise met succes status
   */
  async werkItemBij(lijstNaam, itemId, itemData, lijstId = null) {
    try {
      // Valideer de selectie
      if (this.huidigeSelectie && this.huidigeSelectie.id !== itemId) {
        this._logWaarschuwing(`Inconsistente selectie gedetecteerd: UI selectie=${this.huidigeSelectie.id}, Aangevraagde update voor=${itemId}`);
        
        // Optioneel: Gooi een fout of vraag om bevestiging
        if (!confirm(`LET OP: Je probeert item ${itemId} bij te werken, maar item ${this.huidigeSelectie.id} is geselecteerd. Wil je doorgaan?`)) {
          this._logInfo("Bewerking geannuleerd door gebruiker vanwege inconsistente selectie");
          return false;
        }
      }
      
      this.activeLijst = lijstNaam;
      const url = `${this.siteUrl}/_api/web/lists/getbytitle('${lijstNaam}')/items(${itemId})`;
      
      this._logInfo(`API Aanroep: PATCH ${url}`, itemData);
      
      // Haal eerst de metadata op die we nodig hebben voor de update
      const getResponse = await fetch(`${url}?$select=Id`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json;odata=verbose'
        }
      });
      
      if (!getResponse.ok) {
        throw new Error(`HTTP fout ${getResponse.status}: ${getResponse.statusText}`);
      }
      
      const getMetaData = await getResponse.json();
      const etag = getMetaData.d.__metadata.etag;
      const itemType = getMetaData.d.__metadata.type;
      
      // Zorg ervoor dat we geen ID meesturen
      const schoneData = { ...itemData };
      delete schoneData.Id;
      delete schoneData.id;
      
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Accept': 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose',
          'X-RequestDigest': this.requestDigest,
          'IF-MATCH': etag,
          'X-HTTP-Method': 'MERGE'
        },
        body: JSON.stringify({ '__metadata': { 'type': itemType }, ...schoneData })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP fout ${response.status}: ${response.statusText}`);
      }
      
      this._logInfo(`Item met ID ${itemId} bijgewerkt in "${lijstNaam}"`);
      
      // Update laatsteOperatie voor debugging
      this.laatsteOperatie = {
        type: "BIJWERKEN",
        lijst: lijstNaam,
        tijdstempel: new Date().toISOString(),
        itemId: itemId
      };
      
      // Reset huidige selectie na een succesvolle update
      this.resetSelectie();
      
      // Ververs de tabel indien nodig
      if (lijstId && this.tabelVerversCallbacks.has(lijstId)) {
        this._logInfo(`Tabel verversen voor lijst ${lijstNaam} (ID: ${lijstId})`);
        await this.tabelVerversCallbacks.get(lijstId)();
      }
      
      return true;
    } catch (fout) {
      this._verwerkFout(fout, "werkItemBij", { lijstNaam, itemId, itemData });
      return false;
    }
  }

  /**
   * Verwijdert een item uit een SharePoint lijst
   * @param {string} lijstNaam - De naam van de SharePoint lijst
   * @param {number} itemId - De ID van het item om te verwijderen
   * @param {boolean} bevestigingVereist - Of een bevestiging vereist is
   * @param {string} lijstId - Optionele lijst ID voor verversing
   * @returns {Promise<boolean>} - Promise met succes status
   */
  async verwijderItem(lijstNaam, itemId, bevestigingVereist = true, lijstId = null) {
    try {
      // Valideer de selectie
      if (this.huidigeSelectie && this.huidigeSelectie.id !== itemId) {
        const foutmelding = `VEILIGHEIDSCONTROLE MISLUKT: Je probeert item ${itemId} te verwijderen, maar item ${this.huidigeSelectie.id} is geselecteerd!`;
        this._logFout(foutmelding);
        
        // Bij verwijdering altijd stoppen bij inconsistente selectie, ongeacht bevestigingVereist
        throw new Error(foutmelding);
      }
      
      // Vraag om bevestiging indien vereist
      if (bevestigingVereist) {
        if (!confirm(`Weet je zeker dat je het item met ID ${itemId} wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt.`)) {
          this._logInfo("Verwijdering geannuleerd door gebruiker");
          return false;
        }
      }
      
      this.activeLijst = lijstNaam;
      const url = `${this.siteUrl}/_api/web/lists/getbytitle('${lijstNaam}')/items(${itemId})`;
      
      this._logInfo(`API Aanroep: DELETE ${url}`);
      
      // Haal eerst de metadata op die we nodig hebben voor de verwijdering
      const getResponse = await fetch(`${url}?$select=Id`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json;odata=verbose'
        }
      });
      
      if (!getResponse.ok) {
        throw new Error(`HTTP fout ${getResponse.status}: ${getResponse.statusText}`);
      }
      
      const getMetaData = await getResponse.json();
      const etag = getMetaData.d.__metadata.etag;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json;odata=verbose',
          'Content-Type': 'application/json;odata=verbose',
          'X-RequestDigest': this.requestDigest,
          'IF-MATCH': etag,
          'X-HTTP-Method': 'DELETE'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP fout ${response.status}: ${response.statusText}`);
      }
      
      this._logInfo(`Item met ID ${itemId} verwijderd uit "${lijstNaam}"`);
      
      // Update laatsteOperatie voor debugging
      this.laatsteOperatie = {
        type: "VERWIJDEREN",
        lijst: lijstNaam,
        tijdstempel: new Date().toISOString(),
        itemId: itemId
      };
      
      // Reset huidige selectie na een succesvolle verwijdering
      this.resetSelectie();
      
      // Ververs de tabel indien nodig
      if (lijstId && this.tabelVerversCallbacks.has(lijstId)) {
        this._logInfo(`Tabel verversen voor lijst ${lijstNaam} (ID: ${lijstId})`);
        await this.tabelVerversCallbacks.get(lijstId)();
      }
      
      return true;
    } catch (fout) {
      this._verwerkFout(fout, "verwijderItem", { lijstNaam, itemId });
      return false;
    }
  }

  /**
   * Stelt de huidige geselecteerde rij in
   * @param {number} itemId - De ID van het geselecteerde item
   * @param {string} lijstNaam - De naam van de lijst waaruit het item is geselecteerd
   */
  setSelectie(itemId, lijstNaam) {
    try {
      if (!itemId) {
        this.resetSelectie();
        return;
      }
      
      this.huidigeSelectie = {
        id: itemId,
        lijst: lijstNaam,
        tijdstempel: new Date().toISOString()
      };
      
      this._logInfo(`Selectie ingesteld op item ID: ${itemId} in lijst "${lijstNaam}"`);
    } catch (fout) {
      this._verwerkFout(fout, "setSelectie", { itemId, lijstNaam });
    }
  }

  /**
   * Reset de huidige selectie
   */
  resetSelectie() {
    try {
      this.huidigeSelectie = null;
      this._logInfo("Selectie gereset");
    } catch (fout) {
      this._verwerkFout(fout, "resetSelectie");
    }
  }

  /**
   * Controleert of een selectie actief is
   * @returns {boolean} - Of er een selectie actief is
   */
  heeftSelectie() {
    return this.huidigeSelectie !== null;
  }

  /**
   * Haalt de huidige selectie op
   * @returns {Object|null} - De huidige selectie of null
   */
  getSelectie() {
    return this.huidigeSelectie;
  }

  /**
   * Krijg informatie over de laatste operatie voor debugging
   * @returns {Object|null} - De laatste operatie informatie
   */
  getLaatsteOperatie() {
    return this.laatsteOperatie;
  }

  /**
   * Genereert een uniek ID voor interne referentie
   * @returns {string} - Een uniek ID
   * @private
   */
  _genereerId() {
    return 'xxxx-xxxx-xxxx-xxxx'.replace(/x/g, () => {
      return Math.floor(Math.random() * 16).toString(16);
    });
  }

  /**
   * Logt informatie naar de console als debugMode aan staat
   * @param {string} bericht - Het bericht om te loggen
   * @param {Object} data - Optionele data om te loggen
   * @private
   */
  _logInfo(bericht, data = null) {
    if (this.debugMode) {
      if (data) {
        console.log(`%c[SP Config] INFO: ${bericht}`, 'color: blue', data);
      } else {
        console.log(`%c[SP Config] INFO: ${bericht}`, 'color: blue');
      }
    }
  }

  /**
   * Logt een waarschuwing naar de console
   * @param {string} bericht - Het bericht om te loggen
   * @param {Object} data - Optionele data om te loggen
   * @private
   */
  _logWaarschuwing(bericht, data = null) {
    if (data) {
      console.warn(`[SP Config] WAARSCHUWING: ${bericht}`, data);
    } else {
      console.warn(`[SP Config] WAARSCHUWING: ${bericht}`);
    }
  }

  /**
   * Logt een fout naar de console
   * @param {string} bericht - Het bericht om te loggen
   * @param {Object} data - Optionele data om te loggen
   * @private
   */
  _logFout(bericht, data = null) {
    if (data) {
      console.error(`[SP Config] FOUT: ${bericht}`, data);
    } else {
      console.error(`[SP Config] FOUT: ${bericht}`);
    }
  }

  /**
   * Verwerkt een fout en logt deze naar de console
   * @param {Error} fout - De fout die is opgetreden
   * @param {string} methode - De methode waarin de fout is opgetreden
   * @param {Object} params - De parameters die zijn gebruikt bij de methode
   * @private
   */
  _verwerkFout(fout, methode, params = {}) {
    const foutmelding = `Fout in ${methode}: ${fout.message}`;
    
    // Log naar console
    console.error(`[SP Config] FOUT: ${foutmelding}`, {
      fout: fout,
      stack: fout.stack,
      methode: methode,
      params: params,
      lijst: this.activeLijst,
      selectie: this.huidigeSelectie
    });
    
    // Toon een gebruikersvriendelijke foutmelding als we in debug modus zijn
    if (this.debugMode) {
      alert(`SharePoint Operatie Fout:\n${foutmelding}\n\nControleer de console voor meer details.`);
    }
    
    // De fout opnieuw gooien om afhandeling mogelijk te maken
    throw new Error(foutmelding);
  }
}

// Exporteer een singleton instantie van de service
export const SPConfig = new SPListConfigService();
export default SPConfig;
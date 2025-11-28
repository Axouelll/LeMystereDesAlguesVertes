/* --- VARIABLES GLOBALES --- */
let stations;
let algues;
let map;

// Données
let concentrationData = {}; 
let stationMetrics = {};    
let currentStationID = null; 
const GLOBAL_ID = "__all_stations__";
const binWidth = 0.05; 

// Compteurs
let totalMeasureCount = 0;
let totalDangerCount = 0; 

// Gestion Physique & Carte
let stationLayer = L.layerGroup(); 
let stationNames = {}; 
let stationNodes = []; 

// Variables Drag & Drop
let draggedNode = null; 
let isDragging = false; 
let wasDragged = false; 
let dragStartX = 0;
let dragStartY = 0;
let isZooming = false;

/* --- FONCTIONS UTILITAIRES --- */

function mapValue(value, inMin, inMax, outMin, outMax) {
  if (inMin === inMax) return outMin; 
  const norm = (value - inMin) / (inMax - inMin);
  return norm * (outMax - outMin) + outMin;
}

function constrainValue(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function parseCSVDate(rawDateStr) {
    if (!rawDateStr) return null;
    const datePart = rawDateStr.split(' ')[0];
    const parts = datePart.split('/');
    if (parts.length === 3) {
        let m = parts[0];
        let d = parts[1];
        let y = parts[2];
        if (m.length === 1) m = '0' + m;
        if (d.length === 1) d = '0' + d;
        if (y.length === 2) y = '20' + y;
        return `${y}-${m}-${d}`;
    }
    return null;
}

function parseCSVTime(rawDateStr) {
    if (!rawDateStr) return null;
    const parts = rawDateStr.split(' ');
    if (parts.length < 2) return null;
    const timePart = parts[1]; 
    return "1970-01-01 " + timePart;
}

function getColorForConcentration(value) {
    if (value < 0.05) return '#87CC21'; 
    if (value < 0.2) return '#b5ff5e';  
    if (value < 1.0) return '#ff91d1';  
    if (value < 2.0) return '#e845b2';  
    return '#212121';                   
}

/* --- MOTEUR PHYSIQUE RIGIDE (CODE 2 - STRICT) --- */
function runPhysicsLoop() {
    if (!map || stationNodes.length === 0) {
        requestAnimationFrame(runPhysicsLoop);
        return;
    }

    if (isZooming) {
        requestAnimationFrame(runPhysicsLoop);
        return;
    }

    // --- PARAMÈTRES DE RIGIDITÉ ---
    const padding = 1.5;       // Espace strict entre les bulles
    const returnSpeed = 0.2;   // Vitesse de retour à la position GPS
    const iterations = 8;      // Stabilité du calcul

    // 1. Mise à jour des cibles GPS -> Pixels
    stationNodes.forEach(node => {
        const point = map.latLngToLayerPoint(node.originalLatLng);
        node.targetX = point.x;
        node.targetY = point.y;
        
        // Initialisation
        if (typeof node.x === 'undefined' || isNaN(node.x)) {
            node.x = node.targetX;
            node.y = node.targetY;
        }
    });

    // 2. Résolution des contraintes
    for (let k = 0; k < iterations; k++) {
        
        // A. Retour vers le GPS
        stationNodes.forEach(node => {
            if (node === draggedNode) return;
            // Déplacement direct vers la cible (pas de ressort mou)
            node.x += (node.targetX - node.x) * returnSpeed;
            node.y += (node.targetY - node.y) * returnSpeed;
        });

        // B. Résolution des collisions
        for (let i = 0; i < stationNodes.length; i++) {
            let n1 = stationNodes[i];
            if (n1.currentRadius === 0) continue;

            for (let j = i + 1; j < stationNodes.length; j++) {
                let n2 = stationNodes[j];
                if (n2.currentRadius === 0) continue;

                let dx = n2.x - n1.x;
                let dy = n2.y - n1.y;
                let distSq = dx * dx + dy * dy;
                
                let minDist = n1.currentRadius + n2.currentRadius + padding;
                
                if (distSq < minDist * minDist) {
                    let dist = Math.sqrt(distSq);
                    if (dist === 0) { dist = 0.01; dx = 0.01; } 

                    let penetration = minDist - dist;
                    let nx = dx / dist;
                    let ny = dy / dist;

                    // Séparation équitable (0.5 chacun)
                    let moveX = nx * penetration * 0.5;
                    let moveY = ny * penetration * 0.5;

                    if (n1 === draggedNode) {
                        n2.x += moveX * 2;
                        n2.y += moveY * 2;
                    } else if (n2 === draggedNode) {
                        n1.x -= moveX * 2;
                        n1.y -= moveY * 2;
                    } else {
                        n1.x -= moveX;
                        n1.y -= moveY;
                        n2.x += moveX;
                        n2.y += moveY;
                    }
                }
            }
        }
    }

    // 3. Application visuelle
    stationNodes.forEach(node => {
        if (Math.abs(node.x - node.prevX) > 0.1 || Math.abs(node.y - node.prevY) > 0.1) {
            const newLatLng = map.layerPointToLatLng(L.point(node.x, node.y));
            node.marker.setLatLng(newLatLng);
            node.prevX = node.x;
            node.prevY = node.y;
        }
    });

    requestAnimationFrame(runPhysicsLoop);
}


/* --- FONCTIONS GRAPHIQUES --- */

function createHistogramData(dataValues, binSize) {
  if (!dataValues || dataValues.length === 0) return { x: [], y: [], width: [] };
  const min = 0;
  const dataMax = Math.max(...dataValues);
  const max = Math.max(dataMax, 1.1); 
  const numBins = Math.ceil((max - min) / binSize);
  if (numBins <= 0 || !isFinite(numBins)) return { x: [], y: [], width: [] };
  let binCounts = new Array(numBins).fill(0);
  let binCenters = new Array(numBins);
  for(let i = 0; i < numBins; i++) binCenters[i] = min + (i + 0.5) * binSize;
  for (const val of dataValues) {
    if (val > min) { 
      const binIndex = Math.floor((val - min) / binSize);
      if (binIndex < numBins) binCounts[binIndex]++;
      else if (val <= max) binCounts[numBins - 1]++;
    } else if (val === 0) binCounts[0]++;
  }
  let finalX = [], finalY = [], finalWidth = [];
  for (let i=0; i < numBins; i++) {
      if (binCounts[i] > 0) {
          finalX.push(binCenters[i]);
          finalY.push(binCounts[i]);
          finalWidth.push(binSize);
      }
  }
  return { x: finalX, y: finalY, width: finalWidth };
}

function getStats(dataValues) {
    if (!dataValues || dataValues.length === 0) {
        return { count: 0, min: 'N/A', max: 'N/A', mean: 'N/A', median: 'N/A', countOver1: 0 };
    }
    const sorted = [...dataValues].sort((a, b) => a - b);
    const sum = dataValues.reduce((a, b) => a + b, 0);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    const mean = sum / dataValues.length;
    const countOver1 = dataValues.filter(v => v >= 1).length;
    return {
        count: dataValues.length, 
        min: sorted[0].toFixed(3), 
        max: sorted[sorted.length - 1].toFixed(3),
        mean: mean.toFixed(3), 
        median: median.toFixed(3), 
        countOver1: countOver1
    };
}

// --- NAVIGATION JOURNALIÈRE ---
function renderDateNavigation(stationID, currentDate) {
    const existingNav = document.getElementById('daily-nav-container');
    if (existingNav) existingNav.remove();

    if (!currentDate || stationID === GLOBAL_ID) return;

    const stationAllData = concentrationData[stationID];
    if (!stationAllData || !stationAllData["all"]) return;

    const uniqueDates = [...new Set(stationAllData["all"].map(d => d.date))].sort();
    
    const currentIndex = uniqueDates.indexOf(currentDate);
    if (currentIndex === -1) return;

    const prevDate = currentIndex > 0 ? uniqueDates[currentIndex - 1] : null;
    const nextDate = currentIndex < uniqueDates.length - 1 ? uniqueDates[currentIndex + 1] : null;

    const navDiv = document.createElement('div');
    navDiv.id = 'daily-nav-container';
    navDiv.className = 'day-nav-container';

    // Bouton Précédent
    const btnPrev = document.createElement('button');
    btnPrev.className = 'day-nav-btn';
    btnPrev.innerText = '← Jour précédent';
    if (prevDate) {
        btnPrev.onclick = () => updateSidebar(stationID, "all", prevDate);
    } else {
        btnPrev.disabled = true;
    }

    // Bouton Suivant
    const btnNext = document.createElement('button');
    btnNext.className = 'day-nav-btn';
    btnNext.innerText = 'Jour suivant →';
    if (nextDate) {
        btnNext.onclick = () => updateSidebar(stationID, "all", nextDate);
    } else {
        btnNext.disabled = true;
    }

    navDiv.appendChild(btnPrev);
    navDiv.appendChild(btnNext);

    const parent = document.getElementById('sidebar-content');
    parent.appendChild(navDiv);
}

// --- GRAPHIQUE JOURNALIER ---
function updateDailyChart(stationID, specificDate, dailyData) {
    let dailyDiv = document.getElementById('sidebar-daily-plot');
    
    if (!dailyDiv) {
        dailyDiv = document.createElement('div');
        dailyDiv.id = 'sidebar-daily-plot';
        dailyDiv.style.marginTop = '20px';
        dailyDiv.style.borderTop = '1px solid #ddd';
        dailyDiv.style.paddingTop = '10px';
        dailyDiv.style.height = '250px'; 
        dailyDiv.style.width = '100%';
        
        const parent = document.getElementById('sidebar-content'); 
        if (parent) parent.appendChild(dailyDiv);
    }

    if (!dailyData || dailyData.length === 0) {
        dailyDiv.style.display = 'none';
        return;
    }

    dailyDiv.style.display = 'block';

    dailyData.sort((a, b) => {
        return new Date(a.time).getTime() - new Date(b.time).getTime();
    });

    const xValues = dailyData.map(d => d.time);
    const yValues = dailyData.map(d => d.value);
    
    const pointColors = yValues.map(v => getColorForConcentration(v));

    let trace = {
        x: xValues,
        y: yValues,
        type: 'scatter',
        mode: 'lines+markers',
        line: { 
            color: '#666', 
            width: 1.5 
        },
        marker: { 
            color: pointColors,
            size: 8,
            line: { color: 'white', width: 1 }
        },
        name: 'H2S',
        hoverinfo: 'y+x'
    };

    let layout = {
        title: { text: `Évolution le ${specificDate}`, font: { size: 14 } },
        xaxis: { 
            title: 'Heure', 
            type: 'date', 
            tickformat: '%H:%M',
            fixedrange: true 
        },
        yaxis: { 
            title: 'ppm', 
            fixedrange: true, 
            rangemode: 'tozero' 
        },
        margin: { l: 40, r: 20, b: 40, t: 40 },
        showlegend: false,
        dragmode: false,
        displayModeBar: false,
        shapes: [
            {
                type: 'line',
                x0: 0,
                x1: 1,
                xref: 'paper',
                y0: 1,
                y1: 1,
                yref: 'y',
                line: {
                    color: 'black',
                    width: 1.5,
                    dash: 'dot'
                }
            }
        ]
    };
    
    let config = { displayModeBar: false, responsive: true };

    Plotly.newPlot(dailyDiv, [trace], layout, config);
}

function updateMarkers(selectedYear, specificDate = null) {
    const baseRadius = 6;   
    const maxRadius = 20;   

    for (const node of stationNodes) {
        const idStation = node.id;
        const stationData = concentrationData[idStation];
        let valuesToMap = [];

        if (stationData) {
            let objectsToProcess = [];
            if (specificDate) {
                objectsToProcess = stationData["all"].filter(d => d.date === specificDate);
            } else {
                if (stationData[selectedYear]) {
                    objectsToProcess = stationData[selectedYear];
                }
            }
            valuesToMap = objectsToProcess.map(d => d.value);
        }

        let style;
        let radius = 0;

        if (valuesToMap.length > 0) {
            const max = Math.max(...valuesToMap); 
            let rCalc = mapValue(max, 0, 1, baseRadius, maxRadius);
            radius = constrainValue(rCalc, baseRadius, 30);
            
            style = {
                fillColor: getColorForConcentration(max), 
                fillOpacity: 0.8, 
                radius: radius,
                color: 'white', 
                weight: 1.5,
                opacity: 1.0,     
            };
        } else {
            radius = 5;
            style = {
                fillColor: "#AAAAAA",
                fillOpacity: 0.5, 
                radius: radius,
                color: '#cccccc',
                weight: 1,
                opacity: 0.6
            };
        }
        
        if (idStation === currentStationID && currentStationID !== GLOBAL_ID) {
            style.color = '#222';       
            style.weight = 3; 
            style.opacity = 1;
            style.fillOpacity = 1; 
        }
        
        node.marker.setStyle(style);
        node.currentRadius = radius; 
    }
}

function updateSidebar(stationID, year, specificDate = null) {
    console.log(`Mise à jour: ${stationID}, Année: ${year}, Date: ${specificDate}`);
    
    // === FIX : CAPTURE DE LA POSITION DE SCROLL AVANT MISE A JOUR ===
    const sidebarContent = document.getElementById('sidebar-content');
    let previousScrollTop = 0;
    if (sidebarContent) {
        previousScrollTop = sidebarContent.scrollTop;
    }
    // =================================================================
    
    currentStationID = stationID; 
    updateMarkers(year, specificDate); 

    const stationAllData = concentrationData[stationID];
    if (!stationAllData) { return; }
    
    let filteredObjects = [];
    
    if (specificDate) {
        filteredObjects = stationAllData["all"].filter(d => d.date === specificDate);
    } else {
        filteredObjects = stationAllData[year] || [];
    }

    const dataValues = filteredObjects.map(d => d.value);

    // UI Updates
    let title;
    if (stationID === GLOBAL_ID) title = "Toutes les stations";
    else title = stationNames[stationID] || `Station ${stationID}`;
    document.getElementById('sidebar-title').innerText = title;
    
    const filterDiv = document.getElementById('sidebar-filter');
    let dateInputValue = specificDate || "";
    const availableYears = Object.keys(stationAllData).filter(y => y !== "all").sort((a,b) => a-b);
    
    let filterHTML = `
        <div class="date-filter-container">
            <label for="date-search">Filtrer par date précise :</label>
            <input type="date" id="date-search" value="${dateInputValue}">
        </div>
        <strong>Ou par année :</strong><br>
        <div id="year-filter-buttons" style="margin-top: 5px;">
    `;
    
    const isYearActive = (y) => !specificDate && (y === year);
    filterHTML += `<button class="year-btn ${isYearActive('all') ? 'active-button' : ''}" data-year="all">Toutes</button>`;
    for (const y of availableYears) {
        filterHTML += `<button class="year-btn ${isYearActive(y) ? 'active-button' : ''}" data-year="${y}">${y}</button>`;
    }
    filterHTML += '</div>';
    filterDiv.innerHTML = filterHTML;

    document.querySelectorAll('.year-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.stopPropagation(); 
            updateSidebar(currentStationID, this.dataset.year, null);
        });
    });

    const dateInput = document.getElementById('date-search');
    dateInput.addEventListener('change', function(e) {
        const val = this.value;
        if(val) updateSidebar(currentStationID, "all", val);
        else updateSidebar(currentStationID, "all", null);
    });
    
    // Stats
    const stats = getStats(dataValues);
    let percentage = 0;
    if (totalMeasureCount > 0 && stats.count > 0) {
        percentage = (stats.count / totalMeasureCount * 100).toFixed(1);
    }
    
    let dangerPercentage = 0;
    if (totalDangerCount > 0 && stats.countOver1 > 0) {
        dangerPercentage = (stats.countOver1 / totalDangerCount * 100).toFixed(1);
    }
    
    const isFiltered = (stationID !== GLOBAL_ID) || (year !== "all") || (specificDate !== null);
    
    const percentageStr = (isFiltered && stats.count > 0) ? ` (${percentage} %)` : '';
    const dangerPercentageStr = (isFiltered && stats.countOver1 > 0) ? ` (${dangerPercentage} %)` : '';

    const dangerDiv = document.getElementById('danger-box');
    if (dataValues.length === 0) {
        dangerDiv.innerHTML = `<div class="danger-count" style="background:#ddd; color:#555">Aucune donnée</div>`;
    } else {
        dangerDiv.innerHTML = `<div class="danger-count">${stats.countOver1} mesure(s) &ge; 1 ppm${dangerPercentageStr}</div>`;
    }
    
    let statTitleSuffix = "";
    if (specificDate) {
        statTitleSuffix = ` (${specificDate})`;
    } else if (year !== "all") {
        statTitleSuffix = ` ${year}`; 
    }

    const statsDiv = document.getElementById('sidebar-stats');
    statsDiv.innerHTML = `
        <h3>Statistiques${statTitleSuffix}</h3>
        <ul>
            <li>Nombre de mesures: <strong>${stats.count}${percentageStr}</strong></li>
            <li>Maximum: <strong>${stats.max} ppm</strong></li>
            <li>Moyenne: <strong>${stats.mean} ppm</strong></li>
            <li>Médiane: <strong>${stats.median} ppm</strong></li>
        </ul>
    `;
    
    // --- HISTOGRAMME ---
    const plotDiv = document.getElementById('sidebar-plot');
    
    if (dataValues.length === 0) {
        Plotly.purge(plotDiv);
        plotDiv.innerHTML = "<p style='text-align:center; padding:20px; color:#666;'><i>Aucune donnée disponible.</i></p>";
        const existingLegend = document.getElementById('histogram-legend');
        if (existingLegend) existingLegend.remove();
        plotDiv.style.display = 'block';
        
        const dailyDiv = document.getElementById('sidebar-daily-plot');
        if (dailyDiv) dailyDiv.style.display = 'none';
        const navDiv = document.getElementById('daily-nav-container');
        if (navDiv) navDiv.remove();
        
        // Restauration scroll (cas vide)
        if (sidebarContent) sidebarContent.scrollTop = previousScrollTop;
        return; 
    }

    plotDiv.innerHTML = '';

    let traces = [];
    const bins = createHistogramData(dataValues, binWidth);
    let yMaxLog = 1;
    if (bins.y.length > 0) yMaxLog = Math.ceil(Math.log10(Math.max(...bins.y))); 
    
    if (bins.x.length > 0) {
        const barColors = bins.x.map(val => getColorForConcentration(val));
        traces.push({
            x: bins.x, y: bins.y, width: binWidth, type: 'bar',
            marker: { color: barColors, line: { color: 'white', width: 0.5 } },
            hoverinfo: 'y'
        });
    }

    let layout = {
        title: { text: `H2S${statTitleSuffix}`, font: { size: 14 } },
        yaxis: { 
            title: 'Effectif', type: 'log', range: [-0.2, yMaxLog], dtick: 1, automargin: true,
            fixedrange: true 
        },
        xaxis: { 
            title: 'Concentration (ppm)', 
            range: [0, Math.max(1.1, (dataValues.length > 0 ? Math.max(...dataValues) : 0) + binWidth)],
            fixedrange: true 
        },
        margin: { l: 40, r: 20, b: 40, t: 40 },
        showlegend: false,
        dragmode: false, 
        hovermode: 'closest', 
        shapes: [{ type: 'line', x0: 1, x1: 1, y0ref: 'paper', y0: 0, layer: 'above', line: { color: 'black', width: 2.5, dash: 'dot' } }]
    };
    
    let config = { displayModeBar: false, responsive: true };
    
    Plotly.newPlot(plotDiv, traces, layout, config);
    
    let legendDiv = document.getElementById('histogram-legend');
    if (!legendDiv) {
        legendDiv = document.createElement('div');
        legendDiv.id = 'histogram-legend';
        plotDiv.parentNode.insertBefore(legendDiv, plotDiv.nextSibling);
    }
    legendDiv.innerHTML = `
        <div class="legend-title">Niveaux de risque H2S :</div>
        <div class="legend-item"><span class="legend-color" style="background:#87CC21"></span> 0 - 0.05 : Air normal</div>
        <div class="legend-item"><span class="legend-color" style="background:#B5FF5E"></span> 0.05 - 0.2 : Air peu altéré</div>
        <div class="legend-item"><span class="legend-color" style="background:#FF91D1"></span> 0.2 - 1 : Air altéré</div>
        <div class="legend-item"><span class="legend-color" style="background:#E845B2"></span> 1 - 2 : Air très altéré</div>
        <div class="legend-item"><span class="legend-color" style="background:#212121"></span> > 2 : Air toxique</div>
    `;
    
    document.getElementById('sidebar-plot').style.display = 'block';

    if (specificDate && stationID !== GLOBAL_ID) {
        updateDailyChart(stationID, specificDate, filteredObjects);
        renderDateNavigation(stationID, specificDate); 
    } else {
        const dailyDiv = document.getElementById('sidebar-daily-plot');
        if (dailyDiv) dailyDiv.style.display = 'none';
        const navDiv = document.getElementById('daily-nav-container');
        if (navDiv) navDiv.remove();
    }

    // === FIX : RESTAURATION DE LA POSITION DE SCROLL ===
    if (sidebarContent) {
        sidebarContent.scrollTop = previousScrollTop;
    }
    // ====================================================
}


/* --- INIT & SETUP --- */

function preload() {
  console.log("Preload: Chargement des fichiers...");
  try {
    stations = loadStrings('data/stations.csv');
    algues = loadStrings('data/algues.csv');
  } catch (e) {
      console.error("Erreur CSV : ", e);
  }
}

function setup() {
  if (!stations || !algues) {
      console.error("Données CSV manquantes.");
      return;
  }
    
  console.log("Setup: Démarrage.");
  noCanvas(); 
  
  const initialCoords = [48.3, -3.35];
  const initialZoom = 9;
  
  const mapElement = document.getElementById('map');
  if (!mapElement) return;
  
  map = L.map("map").setView(initialCoords, initialZoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy;OpenStreetMap contributors",
    maxZoom: 19,
  }).addTo(map);

  // --- GESTION ZOOM ---
  map.on('zoomstart', () => { isZooming = true; });
  map.on('zoomend', () => {
      isZooming = false;
      stationNodes.forEach(node => { delete node.x; });
  });

  // --- DRAG & DROP AVEC SEUIL 3PX ---
  map.on('mousemove', (e) => {
      if (draggedNode) {
          const dx = e.containerPoint.x - dragStartX;
          const dy = e.containerPoint.y - dragStartY;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist > 3) isDragging = true; 
          
          if (isDragging) {
              L.DomEvent.stop(e);
              const p = map.latLngToLayerPoint(e.latlng);
              draggedNode.x = p.x;
              draggedNode.y = p.y;
              draggedNode.marker.setLatLng(e.latlng);
          }
      }
  });

  map.on('mouseup', () => {
      if (draggedNode) {
          if (isDragging) {
              wasDragged = true;
              setTimeout(() => { wasDragged = false; }, 100);
          }
          draggedNode = null;
          isDragging = false; 
          map.dragging.enable(); 
      }
  });

  // --- CLIC CARTE ---
  map.on('click', () => {
      if (wasDragged) return;
      map.flyTo(initialCoords, initialZoom); 
      const dateInput = document.getElementById('date-search');
      const currentDate = (dateInput && dateInput.value) ? dateInput.value : null;
      map.once('moveend', () => {
          updateSidebar(GLOBAL_ID, "all", currentDate);
      });
  });

  const modal = document.getElementById('modal-backdrop');
  document.getElementById('modal-close').onclick = function() { modal.style.display = "none"; }
  modal.onclick = function(event) { if (event.target == modal) { modal.style.display = "none"; } }

  // --- Parsing Data ---
  concentrationData = {}; 
  concentrationData[GLOBAL_ID] = { "all": [] }; 
  totalMeasureCount = 0; 
  totalDangerCount = 0; 
  
  for (let i = 1; i < algues.length; i++) {
    let colonnesAlgues = algues[i].split(",");
    if (colonnesAlgues.length > 3) { 
      let annee = colonnesAlgues[0].trim();
      let idStation = colonnesAlgues[1].trim(); 
      let rawDate = colonnesAlgues[2].trim();
      let normalizedDate = parseCSVDate(rawDate);
      let parsedTime = parseCSVTime(rawDate);

      let concentrationStr = colonnesAlgues[3].trim(); 

      if (concentrationStr !== "nd" && concentrationStr !== "") {
        let concentrationVal = parseFloat(concentrationStr); 
        if (!isNaN(concentrationVal)) {
          totalMeasureCount++; 
          const finalVal = Math.max(0, concentrationVal); 
          if (finalVal >= 1) totalDangerCount++;
          
          const dataPoint = { 
              date: normalizedDate, 
              time: parsedTime,
              value: finalVal 
          };
          
          if (!concentrationData[idStation]) { concentrationData[idStation] = { "all": [] }; }
          if (!concentrationData[idStation][annee]) { concentrationData[idStation][annee] = []; }
          
          concentrationData[idStation]["all"].push(dataPoint);
          concentrationData[idStation][annee].push(dataPoint);
          if (!concentrationData[GLOBAL_ID][annee]) { concentrationData[GLOBAL_ID][annee] = []; }
          concentrationData[GLOBAL_ID]["all"].push(dataPoint);
          concentrationData[GLOBAL_ID][annee].push(dataPoint);
        }
      }
    }
  }
  
  // --- Initialisation Stations ---
  stationNodes = []; 
  stationLayer.clearLayers();

  for (let i = 1; i < stations.length; i++) {
    let colonnes = stations[i].split(",");
    if (colonnes.length < 4) continue; 
    
    let indice = colonnes[0].trim(); 
    let lat = parseFloat(colonnes[1]);
    let lng = parseFloat(colonnes[2]);
    let nom = colonnes[3].trim();
    if (isNaN(lat) || isNaN(lng)) { continue; }
    
    stationNames[indice] = nom;

    let marker = L.circleMarker([lat, lng], {
        radius: 4,
        fillColor: "#888888",
        color: 'white', 
        weight: 1, 
        opacity: 0.6, 
        fillOpacity: 0.5
    });
    
    marker.bindTooltip(nom, { direction: 'top', offset: [0, -10], opacity: 0.9 });

    let node = {
        id: indice,
        marker: marker,
        originalLatLng: L.latLng(lat, lng),
        currentRadius: 4,
        vx: 0, vy: 0,
        prevX: 0, prevY: 0
    };
    
    marker.on('mousedown', (e) => {
        L.DomEvent.stopPropagation(e); 
        L.DomEvent.preventDefault(e);
        draggedNode = node; 
        isDragging = false; 
        dragStartX = e.containerPoint.x;
        dragStartY = e.containerPoint.y;
        map.dragging.disable(); 
    });

    marker.on('click', (e) => {
        if (isDragging || wasDragged) return;

        L.DomEvent.stopPropagation(e); 
        map.flyTo(node.originalLatLng, 12); 
        const dateInput = document.getElementById('date-search');
        const currentDate = (dateInput && dateInput.value) ? dateInput.value : null;
        map.once('moveend', () => {
            updateSidebar(indice, "all", currentDate); 
        });
    });
    
    stationLayer.addLayer(marker);
    stationNodes.push(node);
  } 
  
  map.addLayer(stationLayer);

  // Handlers resize
  const sidebar = document.getElementById('sidebar');
  const dragger = document.getElementById('dragger');
  const plotDiv = document.getElementById('sidebar-plot');
  if(sidebar && dragger && plotDiv) {
    let initialMouseX = 0;
    let initialSidebarWidth = 0;
    function handleDrag(e) {
        e.preventDefault();
        const deltaX = e.clientX - initialMouseX;
        let newWidth = initialSidebarWidth + deltaX;
        const minWidth = parseInt(getComputedStyle(sidebar).minWidth, 10);
        const maxWidthInPx = (window.innerWidth * 0.6); 
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidthInPx) newWidth = maxWidthInPx;
        sidebar.style.flexBasis = newWidth + 'px';
    }
    function stopDrag() {
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', stopDrag);
        if (map) setTimeout(() => map.invalidateSize(), 100);
        if (plotDiv) Plotly.Plots.resize(plotDiv);
        const daily = document.getElementById('sidebar-daily-plot');
        if(daily) Plotly.Plots.resize(daily);
    }
    dragger.addEventListener('mousedown', (e) => {
        e.preventDefault();
        initialMouseX = e.clientX;
        initialSidebarWidth = sidebar.offsetWidth; 
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', stopDrag);
    });
  }

  updateSidebar(GLOBAL_ID, "all", null);
  runPhysicsLoop();
} 

function draw() { }
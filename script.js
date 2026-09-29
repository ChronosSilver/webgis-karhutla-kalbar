// Inisialisasi Peta dan Pengaturan Penyimpanan Posisi
const defaultCenter = [-0.278781, 111.475285];
const defaultZoom = 7;

// Membaca posisi terakhir dari memori browser (localStorage)
const savedCenter = JSON.parse(localStorage.getItem('mapCenter'));
const savedZoom = localStorage.getItem('mapZoom');

const startCenter = savedCenter || defaultCenter;
const startZoom = savedZoom ? parseInt(savedZoom) : defaultZoom;

// Inisiasi peta dengan mematikan kontrol zoom default (agar bisa dipindah posisinya)
const map = L.map('map', { zoomControl: false }).setView(startCenter, startZoom);

// Pindahkan kontrol zoom ke kanan bawah agar tidak bertabrakan dengan menu filter atau tombol basemap
L.control.zoom({ position: 'bottomright' }).addTo(map);

// --- Logika Sidebar ---
const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('toggle-sidebar');
const openBtn = document.getElementById('open-sidebar');

// Fungsi menutup/membuka sidebar dengan toggle class
toggleBtn.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    // Beritahu peta ukuran layarnya berubah setelah animasi css selesai (0.2s)
    setTimeout(() => map.invalidateSize(), 200);
});

openBtn.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    setTimeout(() => map.invalidateSize(), 200);
});
// ----------------------

// --- Logika Tema (Mode Gelap/Terang) ---
const themeBtn = document.getElementById('toggle-theme');
const savedTheme = localStorage.getItem('appTheme') || 'light';

// Terapkan tema yang tersimpan
if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    themeBtn.textContent = '☀️';
}

themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    
    // Simpan ke memori dan ubah ikon
    localStorage.setItem('appTheme', isDark ? 'dark' : 'light');
    themeBtn.textContent = isDark ? '☀️' : '🌙';
});
// ----------------------

// Simpan posisi peta secara otomatis tiap kali digeser atau di-zoom
map.on('moveend', function() {
    const center = map.getCenter();
    localStorage.setItem('mapCenter', JSON.stringify([center.lat, center.lng]));
    localStorage.setItem('mapZoom', map.getZoom());
});

// Picu ulang render (untuk efek cluster/uncluster) saat zoom selesai
map.on('zoomend', function() {
    // Pastikan allHotspotData sudah terisi sebelum merender ulang
    if (allHotspotData && allHotspotData.length > 0) {
        renderMarkers();
    }
});

// Definisi Pilihan Basemap
const basemaps = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' }),
    satelit: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: '© Esri' }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenTopoMap' })
};

// Baca memori Basemap terakhir (default: osm)
let activeBasemap = localStorage.getItem('activeBasemap') || "osm";
if (!basemaps[activeBasemap]) activeBasemap = "osm";

// Tambahkan basemap awal ke peta
basemaps[activeBasemap].addTo(map);

// Hubungkan UI tombol melayang (float) ke logika peta
const basemapBtns = document.querySelectorAll('.float-btn');
basemapBtns.forEach(btn => {
    // Set status tombol aktif saat pertama kali load
    if (btn.getAttribute('data-layer') === activeBasemap) {
        btn.classList.add('active');
    } else {
        btn.classList.remove('active');
    }

    // Aksi saat tombol diklik
    btn.addEventListener('click', () => {
        const selectedLayer = btn.getAttribute('data-layer');
        if (selectedLayer === activeBasemap) return; // Abaikan jika mengklik yang sama

        // Hapus basemap sebelumnya dan tambahkan yang baru
        map.removeLayer(basemaps[activeBasemap]);
        basemaps[selectedLayer].addTo(map);
        
        // Simpan ke memori
        activeBasemap = selectedLayer;
        localStorage.setItem('activeBasemap', selectedLayer);

        // Perbarui visual tombol
        basemapBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// Fungsi pembantu warna circle marker berdasarkan confidence
function getConfidenceColor(confidence) {
    const level = (confidence || "").toLowerCase().trim();
    if (level === 'high') return "#dc2626"; // Merah
    if (level === 'medium') return "#f97316"; // Oranye
    if (level === 'low') return "#eab308"; // Kuning
    return "#6b7280"; // Abu-abu
}

// LayerGroup untuk menyimpan semua marker agar mudah dihapus/ditambah saat filter
const hotspotLayer = L.layerGroup().addTo(map);
let allHotspotData = []; // Menyimpan semua data mentah CSV

// Variabel untuk menyimpan data GeoJSON Polygon
let rawGeoJsonData = null;
let geoJsonLayer = L.geoJSON(null, {
    style: function(feature) {
        return {
            color: "#2c3e50", // Warna garis batas
            weight: 2,
            fillColor: "#3498db", // Warna isi
            fillOpacity: 0.1 // Transparansi
        };
    },
    onEachFeature: function(feature, layer) {
        if (feature.properties && feature.properties.KABKOT) {
            const kabName = feature.properties.KABKOT; // Misal: "KABUPATEN KETAPANG"
            
            // Tooltip saat mouse hover (sudah tidak perlu tambah "Kab. " karena kata KABUPATEN sudah ada)
            layer.bindTooltip(kabName, {permanent: false, direction: "center"});
            
            // Aksi saat poligon di-klik (Tampilkan Statistik)
            layer.on('click', function(e) {
                // Ambil state filter yang sedang aktif
                const checkedConf = Array.from(document.querySelectorAll('input[name="conf"]:checked')).map(cb => cb.value.toLowerCase());
                const filterSatelit = document.getElementById('filter-satelit').value;
                const startVal = document.getElementById('filter-start-date').value;
                const endVal = document.getElementById('filter-end-date').value;
                const startDate = startVal ? new Date(startVal + 'T00:00:00') : null;
                const endDate = endVal ? new Date(endVal + 'T23:59:59') : null;

                let total = 0, high = 0, medium = 0, low = 0;

                // Hitung jumlah titik api yang masuk kriteria di kabupaten ini
                allHotspotData.forEach(row => {
                    const kab = row['Kab Kota'] ? row['Kab Kota'].trim().toUpperCase() : "";
                    
                    if (kabName.toUpperCase().includes(kab)) {
                        const statusConf = row['Confidence'] ? row['Confidence'].toLowerCase().trim() : "unknown";
                        const sat = row['Satelit'] ? row['Satelit'].trim().toUpperCase() : "UNKNOWN";
                        const tglStr = row['Tanggal'] ? row['Tanggal'].trim() : "";
                        
                        // Cek filter confidence (array includes)
                        const passConfidence = checkedConf.includes(statusConf);
                        // Cek filter satelit (dropdown tunggal)
                        const passSatelit = (filterSatelit === "SEMUA" || sat === filterSatelit);
                        
                        let passTanggal = true;
                        if (tglStr && (startDate || endDate)) {
                            const parts = tglStr.split('-');
                            if (parts.length === 3) {
                                const rowDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`); 
                                if (startDate && rowDate < startDate) passTanggal = false;
                                if (endDate && rowDate > endDate) passTanggal = false;
                            }
                        }
                        
                        if (passConfidence && passSatelit && passTanggal) {
                            total++;
                            if (statusConf === 'high') high++;
                            else if (statusConf === 'medium') medium++;
                            else if (statusConf === 'low') low++;
                        }
                    }
                });

                // Buat template HTML untuk popup statistik
                const popupContent = `
                    <div class="custom-popup">
                        <div class="popup-header" style="border-bottom: 2px solid var(--border-color);">
                            <h4>Statistik Karhutla</h4>
                            <span style="font-size: 0.75rem; font-weight: 600; color: var(--text-muted);">${kabName}</span>
                        </div>
                        <div class="popup-body">
                            <div class="info-row">
                                <span class="info-label">Total Titik Api</span>
                                <span class="info-value" style="font-weight: 800; font-size: 1.1rem;">${total}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label" style="color: #dc2626;">Level High</span>
                                <span class="info-value">${high}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label" style="color: #f97316;">Level Medium</span>
                                <span class="info-value">${medium}</span>
                            </div>
                            <div class="info-row">
                                <span class="info-label" style="color: #eab308;">Level Low</span>
                                <span class="info-value">${low}</span>
                            </div>
                        </div>
                    </div>
                `;
                
                L.popup()
                  .setLatLng(e.latlng)
                  .setContent(popupContent)
                  .openOn(map);
            });
        }
    }
}).addTo(map);

// 1. MEMUAT DATA BATAS WILAYAH (POLYGON GEOJSON)
fetch('batas_kalbar.geojson')
    .then(response => {
        if (!response.ok) throw new Error("File batas_kalbar.geojson belum ada.");
        return response.json();
    })
    .then(geojsonData => {
        rawGeoJsonData = geojsonData;
        geoJsonLayer.addData(geojsonData);
    })
    .catch(err => console.log("Info: Batas wilayah belum dimuat. " + err.message));


// 2. MEMUAT DATA CSV SiPongi & FILTERING
Papa.parse('data_sipongi.csv', {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: function(results) {
        allHotspotData = results.data;
        
        // Buat daftar kabupaten dan satelit unik, serta cari tanggal terbaru
        const kabupatens = new Set();
        const satelits = new Set();
        let latestDateObj = new Date("1970-01-01T00:00:00");
        let latestDateStr = "";
        
        allHotspotData.forEach(row => {
            if(row['Kab Kota'] && row['Kab Kota'].trim() !== "") {
                kabupatens.add(row['Kab Kota'].trim());
            }
            if(row['Satelit'] && row['Satelit'].trim() !== "") {
                satelits.add(row['Satelit'].trim().toUpperCase());
            }
            if(row['Tanggal'] && row['Tanggal'].trim() !== "") {
                const parts = row['Tanggal'].trim().split('-');
                if(parts.length === 3) {
                    const rowDateObj = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
                    if(rowDateObj > latestDateObj) {
                        latestDateObj = rowDateObj;
                        latestDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
                    }
                }
            }
        });

        // Ambil elemen HTML
        const containerKab = document.getElementById('container-kabupaten');
        const containerSat = document.getElementById('container-satelit');
        const filterStartDate = document.getElementById('filter-start-date');
        const filterEndDate = document.getElementById('filter-end-date');
        const btnCheckAllKab = document.getElementById('btn-check-all-kab');

        // Baca memori dari localStorage
        const savedDates = JSON.parse(localStorage.getItem('filterDates')) || null;
        const savedConf = JSON.parse(localStorage.getItem('filterConf')) || null;
        const savedKab = JSON.parse(localStorage.getItem('filterKab')) || null;
        const savedSatStr = localStorage.getItem('filterSatStr') || "SEMUA";

        // Ambil elemen filter satelit
        const filterSatelit = document.getElementById('filter-satelit');

        // Set Default Value untuk rentang tanggal (dari memori atau default awal)
        if (savedDates) {
            filterStartDate.value = savedDates.start || "";
            filterEndDate.value = savedDates.end || "";
        } else {
            filterStartDate.value = "2026-09-01";
            if(latestDateStr) filterEndDate.value = latestDateStr;
        }

        // Set nilai Checkbox Confidence dari memori (jika ada)
        if (savedConf) {
            document.querySelectorAll('input[name="conf"]').forEach(cb => {
                cb.checked = savedConf.includes(cb.value.toLowerCase());
            });
        }

        // Isi opsi Checkbox Kabupaten
        Array.from(kabupatens).sort().forEach(kab => {
            const label = document.createElement('label');
            label.className = 'checkbox-label';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'kab';
            checkbox.value = kab;
            checkbox.checked = savedKab ? savedKab.includes(kab.toUpperCase()) : true; 
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(' ' + kab));
            containerKab.appendChild(label);
        });

        // Isi opsi Dropdown Satelit
        if (filterSatelit) {
            Array.from(satelits).sort().forEach(sat => {
                const option = document.createElement('option');
                option.value = sat;
                option.text = sat;
                filterSatelit.appendChild(option);
            });
            // Set value dari memori
            filterSatelit.value = savedSatStr;
            
            // Tambahkan event listener khusus untuk dropdown ini
            filterSatelit.addEventListener('change', renderMarkers);
        }

        // --- Logika Cerdas Tombol Pilih Semua ---
        function updateBtnCheckAllText() {
            const allKabs = document.querySelectorAll('input[name="kab"]');
            const checkedKabs = document.querySelectorAll('input[name="kab"]:checked');
            // Jika semua dicentang (atau hampir semua), tawarkan "Batal Pilih". 
            // Jika kosong, tawarkan "Pilih Semua".
            const isAllChecked = (allKabs.length > 0 && allKabs.length === checkedKabs.length);
            btnCheckAllKab.textContent = isAllChecked ? "Batal Pilih" : "Pilih Semua";
            return isAllChecked;
        }

        let allKabChecked = updateBtnCheckAllText();

        btnCheckAllKab.addEventListener('click', () => {
            allKabChecked = !allKabChecked;
            document.querySelectorAll('input[name="kab"]').forEach(cb => {
                cb.checked = allKabChecked;
            });
            updateBtnCheckAllText();
            renderMarkers();
        });

        // Event listener ketika filter tanggal diubah
        filterStartDate.addEventListener('change', renderMarkers);
        filterEndDate.addEventListener('change', renderMarkers);
        
        // Event listener untuk semua checkbox (Confidence & Kabupaten)
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                if(cb.name === 'kab') updateBtnCheckAllText();
                renderMarkers();
            });
        });

        // Tampilkan semua marker pertama kali (sudah menggunakan filter tanggal default)
        renderMarkers();
    },
    error: function(err) {
        console.error("Gagal membaca CSV:", err);
    }
});

// Fungsi untuk menggambar marker dan memfilter poligon berdasarkan dropdown
function renderMarkers() {
    // Ambil semua nilai checkbox yang dicentang
    const checkedKab = Array.from(document.querySelectorAll('input[name="kab"]:checked')).map(cb => cb.value.toUpperCase());
    const checkedConf = Array.from(document.querySelectorAll('input[name="conf"]:checked')).map(cb => cb.value.toLowerCase());
    
    // Ambil nilai dari dropdown satelit
    const filterSatelit = document.getElementById('filter-satelit').value;
    
    // Ambil nilai tanggal dan buat objek Date jika ada isinya
    const startVal = document.getElementById('filter-start-date').value;
    const endVal = document.getElementById('filter-end-date').value;
    
    // Simpan semua state filter ke memori browser
    localStorage.setItem('filterDates', JSON.stringify({ start: startVal, end: endVal }));
    localStorage.setItem('filterConf', JSON.stringify(checkedConf));
    localStorage.setItem('filterKab', JSON.stringify(checkedKab));
    localStorage.setItem('filterSatStr', filterSatelit);

    // Set jam ke 00:00:00 untuk Start dan 23:59:59 untuk End agar perbandingan satu hari penuh akurat
    const startDate = startVal ? new Date(startVal + 'T00:00:00') : null;
    const endDate = endVal ? new Date(endVal + 'T23:59:59') : null;

    // 1. Bersihkan marker sebelumnya dari peta
    hotspotLayer.clearLayers();

    // 2. Bersihkan dan muat ulang Poligon jika data tersedia
    if (rawGeoJsonData) {
        geoJsonLayer.clearLayers();
        
        // Saring fitur poligon berdasarkan array checkedKab
        const filteredFeatures = rawGeoJsonData.features.filter(feature => {
            if (!feature.properties.KABKOT) return false;
            // Karena data GeoJSON adalah "KABUPATEN KETAPANG" dan checkbox "KETAPANG",
            // kita cek apakah ada salah satu nilai checkedKab yang ada di dalam nama KABKOT.
            return checkedKab.some(kabName => feature.properties.KABKOT.toUpperCase().includes(kabName));
        });
        
        geoJsonLayer.addData(filteredFeatures);
    }

    // Variabel untuk metrik ringkasan
    let totalHotspots = 0;
    let highRiskCount = 0;
    const affectedKecamatans = new Set();
    let lastDetectionDate = new Date("1970-01-01T00:00:00");
    let lastDetectionStr = "-";

    // Variabel untuk fitur Clustering berdasarkan zoom level (<= 7 berarti zoom out)
    const isZoomedOut = map.getZoom() <= 7;
    const kabClusterData = {};

    // 3. Tambahkan kembali marker yang sesuai filter
    allHotspotData.forEach(row => {
        const lat = parseFloat(row.Latitude || row.Lintang || row.lat);
        const lng = parseFloat(row.Longitude || row.Bujur || row.long);
        const kab = row['Kab Kota'] ? row['Kab Kota'].trim() : "-";
        const statusConfidence = row['Confidence'] ? row['Confidence'].toLowerCase().trim() : "unknown";
        const sat = row['Satelit'] ? row['Satelit'].trim().toUpperCase() : "UNKNOWN";
        const tglStr = row['Tanggal'] ? row['Tanggal'].trim() : ""; // Format dari CSV: DD-MM-YYYY

        // Cek filter Kabupaten & Confidence (array includes)
        const passKabupaten = checkedKab.includes(kab.toUpperCase());
        const passConfidence = checkedConf.includes(statusConfidence);
        
        // Cek filter Satelit (Dropdown tunggal)
        const passSatelit = (filterSatelit === "SEMUA" || sat === filterSatelit);
        
        // Cek apakah lolos filter Rentang Tanggal
        let passTanggal = true;
        let rowDateObj = null;
        if (tglStr) {
            // Konversi "DD-MM-YYYY" menjadi objek Date JS ("YYYY-MM-DD")
            const parts = tglStr.split('-'); // ["07", "09", "2026"]
            if (parts.length === 3) {
                const d = parts[0];
                const m = parts[1];
                const y = parts[2];
                // Waktu di set siang hari agar tidak terkena offset timezone
                rowDateObj = new Date(`${y}-${m}-${d}T12:00:00`); 
                
                if (startDate && rowDateObj < startDate) passTanggal = false;
                if (endDate && rowDateObj > endDate) passTanggal = false;
            }
        }

        if (passKabupaten && passConfidence && passSatelit && passTanggal) {
            
            // 3.A Hitung Metrik Ringkasan
            totalHotspots++;
            if (statusConfidence === 'high') highRiskCount++;
            if (row['Kecamatan']) affectedKecamatans.add(row['Kecamatan'].trim());
            if (rowDateObj && rowDateObj > lastDetectionDate) {
                lastDetectionDate = rowDateObj;
                lastDetectionStr = tglStr;
            }

            // 3.B Gambar Marker atau Kelompokkan (Cluster)
            if (!isNaN(lat) && !isNaN(lng)) {
                if (isZoomedOut) {
                    // Jika di zoom out, kelompokkan data ke masing-masing kabupaten
                    const cleanKab = kab.toUpperCase();
                    if (!kabClusterData[cleanKab]) {
                        kabClusterData[cleanKab] = { count: 0, highCount: 0, latSum: 0, lngSum: 0 };
                    }
                    kabClusterData[cleanKab].count++;
                    kabClusterData[cleanKab].latSum += lat;
                    kabClusterData[cleanKab].lngSum += lng;
                    if (statusConfidence === 'high') kabClusterData[cleanKab].highCount++;
                } else {
                    // Jika zoom in, gambar titik detail secara individual
                    const popupContent = `
                        <div class="custom-popup">
                            <div class="popup-header">
                                <h4>Titik Panas (Hotspot)</h4>
                                <span class="badge ${statusConfidence}">${row['Confidence'] || "-"}</span>
                            </div>
                            <div class="popup-body">
                                <div class="info-row"><span class="info-label">Kabupaten</span><span class="info-value">${kab}</span></div>
                                <div class="info-row"><span class="info-label">Kecamatan</span><span class="info-value">${row['Kecamatan'] || "-"}</span></div>
                                <div class="info-row"><span class="info-label">Desa</span><span class="info-value">${row['Desa'] || "-"}</span></div>
                                <div class="info-row"><span class="info-label">Koordinat</span><span class="info-value">${lat.toFixed(5)}, ${lng.toFixed(5)}</span></div>
                                <div class="info-row"><span class="info-label">Waktu</span><span class="info-value">${row['Tanggal'] || "-"} ${row['Waktu'] || ""}</span></div>
                                <div class="info-row"><span class="info-label">Satelit</span><span class="info-value">${row['Satelit'] || "-"}</span></div>
                            </div>
                        </div>
                    `;

                    const markerColor = getConfidenceColor(statusConfidence);
                    const marker = L.circleMarker([lat, lng], {
                        radius: 6,
                        fillColor: markerColor,
                        color: "#ffffff",
                        weight: 1.5,
                        opacity: 1,
                        fillOpacity: 0.8,
                        pane: 'markerPane' 
                    }).bindPopup(popupContent);
                    
                    hotspotLayer.addLayer(marker);
                }
            }
        }
    });

    // 3.C Gambar Cluster (Jika Zoom Out)
    if (isZoomedOut) {
        Object.keys(kabClusterData).forEach(kabName => {
            const data = kabClusterData[kabName];
            // Gunakan rata-rata koordinat titik sebagai pusat (centroid aproksimasi cepat dan akurat)
            const centerLat = data.latSum / data.count;
            const centerLng = data.lngSum / data.count;
            
            // Atur warna cluster: merah jika ada high risk, oranye jika hanya medium, kuning jika low
            let bgColor = '#eab308'; // Default kuning (low)
            if (data.highCount > 0) bgColor = '#dc2626'; // Merah (high)
            else if (data.count > 0) bgColor = '#f97316'; // Oranye (medium) jika tidak ada high
            
            // Buat HTML ikon
            const clusterIcon = L.divIcon({
                className: 'kab-cluster-icon',
                html: `<div style="background-color: ${bgColor}; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; border: 2px solid white; box-shadow: 0 0 6px rgba(0,0,0,0.5); font-size: 0.85rem;">${data.count}</div>`,
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            });

            const marker = L.marker([centerLat, centerLng], { icon: clusterIcon }).addTo(hotspotLayer);
            
            // Tambahkan tooltip kecil saat dihover
            marker.bindTooltip(`<b>${kabName}</b><br>${data.count} Titik Api Terdeteksi`, { direction: 'top', offset: [0, -14] });
            
            // Jika diklik, zoom in otomatis ke pusat kumpulan titik kabupaten ini
            marker.on('click', () => {
                map.setView([centerLat, centerLng], 8);
            });
        });
    }

    // 4. Render Ringkasan Metrik ke dalam Sidebar HTML
    const summaryContainer = document.getElementById('sidebar-summary');
    if (summaryContainer) {
        summaryContainer.innerHTML = `
            <div class="stat-card">
                <span class="stat-label">Total Titik Panas</span>
                <span class="stat-value">${totalHotspots}</span>
            </div>
            <div class="stat-card">
                <span class="stat-label">Risiko Tinggi</span>
                <span class="stat-value danger">${highRiskCount}</span>
            </div>
            <div class="stat-card">
                <span class="stat-label">Kecamatan Terdampak</span>
                <span class="stat-value">${affectedKecamatans.size}</span>
            </div>
            <div class="stat-card">
                <span class="stat-label">Deteksi Terakhir</span>
                <span class="stat-value text-date">${lastDetectionStr}</span>
            </div>
        `;
    }
}

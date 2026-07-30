(() => {
  "use strict";
  window.AlanMountainMap.createMap().then(map => { window.alanMap = map; }).catch(error => {
    console.error(error);
    const status = document.getElementById("map-status");
    if (status) { status.textContent = `Ошибка запуска карты: ${error.message}`; status.dataset.failed = "true"; }
  });
})();

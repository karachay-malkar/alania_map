atus.textContent = `Горы не загружены: ${error.message}`;
              status.classList.add('error');
            }
          });
          if (typeof originalOnReady === 'function') originalOnReady(api);
        }
      });
      const api = originalMount(target, nextOptions);
      updateUi(host);
      return api;
    };
    Object.defineProperty(AlanMap, '__alanSlippyWrapped', {value: true});
  }

  injectStyle();
  wrapMapConstructor();
  wrapAlanMapMount();
  root.AlanSlippyHybrid = Object.freeze({
    version: VERSION,
    layerIds: LAYER_IDS,
    createMountainLayers,
    ensureMountainLayers,
    diagnosticsFor
  });
})(typeof self !== 'undefined' ? self : this);

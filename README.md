# Mis Pedidos

App personal (PWA) para llevar los pedidos que traigo de Estados Unidos: cuánto cuesta cada cosa, a cuánto la vendo, cuánto me han pagado y por dónde, cuánto falta cobrar, y cuánto le debo a quien también compra.

- Sin servidor ni cuentas: es una página estática (HTML + CSS + JS, sin dependencias).
- **Los datos no están en este repositorio.** Se guardan en el teléfono y, opcionalmente, se respaldan en un repositorio privado aparte (Ajustes → Respaldo automático en GitHub).

## Publicar
Settings → Pages → Deploy from a branch → `main` / `(root)`. La app queda en `https://cjimena0897.github.io/compras-submarine/`.

## Instalar en el celular
Abre esa dirección y: iPhone (Safari) → Compartir → *Agregar a inicio*. Android (Chrome) → menú ⋮ → *Instalar app*.

## Cálculos
- Costo $ = precio × (1 + tax) + comisión (porcentaje sobre el precio con tax, o monto fijo)
- Costo S/ = costo $ × tipo de cambio del pedido
- Falta cobrar = precio de venta − pagos
- Ganancia = precio de venta − costo

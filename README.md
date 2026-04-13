# Prisview
![Prisview](./src/assets/PRISVIEW.png)

Prisview es una aplicación web para **visualizar, editar y entender esquemas de bases de datos** a partir de texto. Permite escribir un schema, validarlo en tiempo real y convertirlo automáticamente en un **diagrama entidad–relación (ER)** interactivo.

Está diseñado como una alternativa ligera y rápida a herramientas como QuickDBD o DBML, con soporte para importación desde ORM (como Prisma) y exportación a SQL.

---

## ✨ Características principales

### 📝 Editor de schema
- DSL propio simple y legible
- Linting en tiempo real con errores por línea
- Autocompletado inteligente:
  - keywords (`pk`, `ref`, `not null`, etc.)
  - tablas dinámicas
  - campos dinámicos (`Tabla.campo`)

---

### 📊 Visualización ER
- Renderizado con React Flow
- Nodos personalizados por tabla
- Relaciones dinámicas con:
  - alineación por campo
  - dirección automática (izquierda/derecha)
- MiniMap + controles de zoom

---

### 🧠 Layout inteligente
- Layout inicial con dagre
- Mantiene posiciones movidas manualmente
- Solo reubica nodos nuevos
- Evita colisiones

---

### 💾 Persistencia
Se guarda automáticamente en localStorage:

- schema
- posiciones de nodos
- viewport (zoom y pan)
- ancho del panel
- dialecto SQL

---

### 🧾 Exportación SQL
Soporte para:

- PostgreSQL
- MySQL
- SQLite

Incluye:
- PK
- NULL / NOT NULL
- UNIQUE
- DEFAULT
- AUTO INCREMENT
- FOREIGN KEYS

---

### 📥 Importación de ORM (Prisma)
- Importa schemas desde Prisma
- Convierte automáticamente a DSL interno
- Soporta:
  - modelos (`model`)
  - relaciones básicas (`@relation`)
  - `@id`, `@unique`, `@default`
- Muestra errores si el schema no es compatible

---

### 🖼️ Copiar imagen
- Copia el diagrama actual al portapapeles
- Excluye UI innecesaria (minimap, controles)
- Alta resolución (pixelRatio 2)

---

## 🧱 Stack tecnológico

- **Astro**
- **React (dentro de Astro)**
- **Tailwind CSS**
- **React Flow**
- **CodeMirror 6**
- **dagre (layout)**
- **html-to-image (export)**

---

## 📦 Instalación

Asegúrate de tener instalado Node.js (recomendado >= 18) y pnpm.

```bash
pnpm install
```

---

## 🚀 Desarrollo

Inicia el servidor de desarrollo:

```bash
pnpm dev
```

La aplicación estará disponible en:

http://localhost:4321

---

## 🏗️ Build

Genera una versión optimizada para producción:

```bash
pnpm build
```

Para previsualizar el build:

```bash
pnpm preview
```

---

## 🧩 DSL del schema

Ejemplo básico:

```txt
User
  id int pk
  name string
  email string

Post
  id int pk
  userId int ref User.id
```

---

## ⚠️ Limitaciones actuales

- No soporta claves primarias compuestas
- Importación Prisma es parcial (no cubre todo el spec)
- No hay merge automático de schemas importados
- Exportación de imagen copia solo el viewport actual

---

## 🧠 Decisiones de diseño

Prisview prioriza:

- claridad del schema
- control manual del layout
- feedback inmediato (lint + visual)
- evitar lógica implícita difícil de mantener

---

## 🔮 Roadmap

- [ ] Soporte completo Prisma
- [ ] Preview antes de importar
- [ ] Merge inteligente de schemas
- [ ] Exportar imagen completa (no solo viewport)
- [ ] Soporte para claves compuestas
- [ ] Hover info en campos
- [ ] Rename refactor

---

## 📄 Licencia

GPL

---

## 🤝 Contribuciones

Las contribuciones son bienvenidas, pero:

- evita soluciones hacky
- prioriza claridad sobre complejidad
- separa responsabilidades (parser / UI / graph)

---

## 🧭 Filosofía

Prisview no intenta reemplazar ORMs ni herramientas pesadas.

Su objetivo es:

**hacer visible lo que normalmente está oculto en texto.**

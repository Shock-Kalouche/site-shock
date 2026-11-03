// Données du site : réglages, page d'accueil et menu.
// Ce fichier est réécrit par l'éditeur du site (bouton « Modifier le site »).
const SITE_DATA = {
  "settings": {
    "siteName": "Garde de Coruscant",
    "sidebarTitle": "Shock Trooper",
    "footerText": "Site de la <strong>Shock Trooper</strong> — Garde de Coruscant",
    "credit": "",
    "discordClientId": "1566877067717513336",
    "discordGuildId": "733070665569140769",
    "discordRoleId": "1313599623004160082"
  },
  "home": {
    "kicker": "Garde de Coruscant",
    "title": "Site de la <span class=\"red\">Shock</span> Trooper",
    "lead": "Bienvenue sur le site de la Shock Trooper ! C'est ici que tu trouveras tous les documents nécessaires lors de ton service.",
    "buttons": [
      {
        "icon": "📕",
        "label": "Guide Shock",
        "page": "guide-shock"
      },
      {
        "icon": "💼",
        "label": "Guide Tenues",
        "page": "guide-tenues"
      },
      {
        "icon": "🥇",
        "label": "Système de Promotion",
        "page": "systeme-de-promotion"
      }
    ],
    "welcomeTitle": "Bienvenue, soldat",
    "welcome": "Bienvenue sur le site de la <strong>Shock Trooper</strong> ! C'est ici que tu trouveras tous les documents nécessaires lors de ton service : protocoles, règlement, grades, véhicules, spécialisations et procédures.",
    "featuredTitle": "Accès rapide",
    "featured": [
      {
        "page": "guide-shock",
        "text": "Tout ce qu'il faut savoir pour ton service."
      },
      {
        "page": "guide-tenues",
        "text": "Les tenues réglementaires selon ton grade."
      },
      {
        "page": "systeme-de-promotion",
        "text": "Comment monter en grade au sein de la Shock."
      },
      {
        "page": "reglement-shock",
        "text": "Les règles à respecter en toutes circonstances."
      },
      {
        "page": "effectif",
        "text": "La liste des membres du régiment."
      },
      {
        "page": "recrutement-shock",
        "text": "Rejoindre les rangs de la Garde de Coruscant."
      },
      {
        "page": "document-protocoles",
        "text": "Les protocoles officiels de la Shock."
      },
      {
        "page": "licences-pilotage",
        "text": "Les licences pour piloter les véhicules."
      }
    ]
  },
  "nav": [
    {
      "id": "accueil",
      "title": "Accueil",
      "icon": "🏠"
    },
    {
      "title": "Protocoles",
      "icon": "📉",
      "children": [
        {
          "id": "site-pour-protocoles",
          "title": "Site pour Protocoles",
          "icon": "📥"
        },
        {
          "id": "casier-shock",
          "title": "Casier Shock",
          "icon": "📂"
        },
        {
          "id": "document-protocoles",
          "title": "Document Protocoles",
          "icon": "📚"
        }
      ]
    },
    {
      "id": "effectif",
      "title": "Effectif",
      "icon": "👥"
    },
    {
      "id": "reglement-shock",
      "title": "Règlement Shock",
      "icon": "📋"
    },
    {
      "id": "guide-shock",
      "title": "Guide Shock",
      "icon": "📕"
    },
    {
      "id": "recrutement-shock",
      "title": "Recrutement Shock",
      "icon": "📋"
    },
    {
      "title": "Grades & Fonctions",
      "icon": "📂",
      "children": [
        {
          "id": "systeme-de-promotion",
          "title": "Système de Promotion",
          "icon": "🥇"
        },
        {
          "id": "fonction-des-grades",
          "title": "Fonction des Différents Grades",
          "icon": "📊"
        }
      ]
    },
    {
      "id": "guide-tenues",
      "title": "Guide Tenues",
      "icon": "💼"
    },
    {
      "id": "base-de-donnee-clones",
      "title": "Base de donnée clones",
      "icon": "🪪"
    },
    {
      "id": "formation-deplacement",
      "title": "Formation Déplacement",
      "icon": "🚶"
    },
    {
      "id": "licences-pilotage",
      "title": "Licences pilotage",
      "icon": "🛫"
    },
    {
      "title": "Véhicule Shock",
      "icon": "🚗",
      "children": [
        {
          "title": "FP1",
          "icon": "📕",
          "children": [
            {
              "id": "at-pt",
              "title": "AT-PT",
              "icon": "🚗"
            },
            {
              "id": "repulsor-tank",
              "title": "Repulsor Tank",
              "icon": "🚗"
            }
          ]
        },
        {
          "title": "FP2",
          "icon": "📕",
          "children": [
            {
              "id": "laat-i",
              "title": "LAAT-I",
              "icon": "🛫"
            },
            {
              "id": "laat-le",
              "title": "LAAT-LE",
              "icon": "🛫"
            },
            {
              "id": "rho-class",
              "title": "Rho-Class",
              "icon": "🛫"
            }
          ]
        },
        {
          "title": "FP3",
          "icon": "📕",
          "children": [
            {
              "id": "radian-vii",
              "title": "Radian VII",
              "icon": "🛫"
            }
          ]
        },
        {
          "title": "Véhicule de Spécialisation",
          "icon": "📕",
          "children": [
            {
              "id": "republic-consular",
              "title": "Republic Consular",
              "icon": "🛫"
            },
            {
              "id": "barc-speeder-medical",
              "title": "Barc Speeder Médical",
              "icon": "🚗"
            }
          ]
        }
      ]
    },
    {
      "title": "Spécialisations",
      "icon": "🗂️",
      "children": [
        {
          "id": "medecins",
          "title": "Médecins",
          "icon": "🩺"
        },
        {
          "id": "crs",
          "title": "CRS",
          "icon": "🔪"
        },
        {
          "id": "bir",
          "title": "BIR",
          "icon": "🛫"
        },
        {
          "id": "ste",
          "title": "STE",
          "icon": "👁️"
        },
        {
          "id": "service-diplomatique",
          "title": "Service Diplomatique",
          "icon": "🎭"
        },
        {
          "id": "rc-regimentaire",
          "title": "RC Régimentaire",
          "icon": "💢"
        },
        {
          "id": "arc-rogue",
          "title": "ARC Rogue",
          "icon": "🥇"
        }
      ]
    },
    {
      "title": "Vidéos Shock",
      "icon": "📹",
      "children": [
        {
          "id": "nouveaux-arrivants",
          "title": "Nouveaux Arrivants",
          "icon": "👔"
        },
        {
          "id": "guide-mise-en-protocole",
          "title": "Guide mise en protocole",
          "icon": "🚧"
        }
      ]
    },
    {
      "title": "Procédures",
      "icon": "📂",
      "children": [
        {
          "id": "peloton-execution",
          "title": "1 - Peloton d'exécution",
          "icon": "🔪"
        },
        {
          "id": "cour-martiale",
          "title": "2 - Cour Martiale",
          "icon": "⚖️"
        },
        {
          "id": "securite-incendie-venator",
          "title": "3 - Sécurité Incendie Vénator",
          "icon": "🔥"
        }
      ]
    },
    {
      "id": "nos-executions",
      "title": "Nos exécutions (P10)",
      "icon": "☠️"
    }
  ]
};

const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
const PORT = process.env.PORT || 3000;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now) return cachedToken;

  const response = await fetch(`https://id.twitch.tv/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
  });

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}

app.get("/game/:id", async (req, res) => {
  try {
    const gameId = req.params.id;
    const token = await getAccessToken();

    const gameResponse = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "text/plain"
      },
      body: `fields name, summary, first_release_date, category, age_ratings.rating, cover.url, artworks.url, platforms.name, 
      involved_companies.company.name, involved_companies.developer, involved_companies.publisher; where id = ${gameId};`
    });

    const gameData = await gameResponse.json(); 

    if (!gameData[0]) {
      return res.status(404).json({ error: "Game not found" });
    }

    const game = gameData[0];
    const result = {
      id: game.id,
      name: game.name,
      summary: game.summary,
      releaseDate: game.first_release_date ? new Date(game.first_release_date * 1000).toLocaleDateString() : 'Desconhecido',
      cover: game.cover ? { url: game.cover.url } : null,
      artworks: game.artworks ? game.artworks.map(art => ({ url: art.url })) : [],
      platforms: game.platforms ? game.platforms.map(p => p.name) : [],
      ageRating: game.age_ratings ? getAgeRating(game.age_ratings[0].rating) : 'Desconhecido',
      genres: game.genres || [],
      companies: processCompanies(game.involved_companies)
    };

    res.json(result);
  } catch (error) {
    console.error("Error fetching game data:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/popular", async (req, res) => {
  try {
    const token = await getAccessToken();
    
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "text/plain"
      },
      body: `fields name, cover.url; 
             where total_rating_count > 50 & cover != null; 
             sort total_rating_count desc; 
             limit 50;`
    });

    const data = await response.json();
    res.json(data.map(game => ({
      id: game.id,
      name: game.name,
      cover: game.cover ? { url: game.cover.url } : null
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint para jogos por gênero
app.get("/genre/:id", async (req, res) => {
  try {
    const genreId = req.params.id;
    const token = await getAccessToken();
    
    const response = await fetch("https://api.igdb.com/v4/games", {
      method: "POST",
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        "Authorization": `Bearer ${token}`,
        "Content-Type": "text/plain"
      },
      body: `fields name, cover.url; 
             where genres = (${genreId}) & cover != null; 
             sort total_rating_count desc; 
             limit 50;`
    });

    const data = await response.json();
    res.json(data.map(game => ({
      id: game.id,
      name: game.name,
      cover: game.cover ? { url: game.cover.url } : null
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function processCompanies(companies) {
  if (!companies) return { developers: [], publishers: [] };
  
  const developers = companies
    .filter(c => c.developer)
    .map(c => c.company.name);
  
  const publishers = companies
    .filter(c => c.publisher)
    .map(c => c.company.name);
  
  return {
    developers: [...new Set(developers)],
    publishers: [...new Set(publishers)]
  };
}

function getAgeRating(rating) {
  const ratings = {
    1: 'PEGI 3',
    2: 'PEGI 7',
    3: 'PEGI 12',
    4: 'PEGI 16',
    5: 'PEGI 18',
    6: 'RP (Classificação Pendente)',
    7: 'EC (Primeira Infância)',
    8: 'E (Todos)',
    9: 'E10+ (Todos +10)',
    10: 'T (Adolescentes)',
    11: 'M (Maduro 17+)',
    12: 'AO (Apenas Adultos)'
  };
  return ratings[rating] || 'Desconhecido';
}

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
import { PrismaClient } from '@prisma/client';
import * as https from 'https';
import * as fs from 'fs';
import * as readline from 'readline';

const prisma = new PrismaClient();
const CSV_URL = 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat';
const TMP_FILE = '/tmp/openflights-airports.dat';

const COUNTRY_TO_ISO: Record<string, string> = {
  'Afghanistan':'AF','Albania':'AL','Algeria':'DZ','Angola':'AO','Argentina':'AR',
  'Armenia':'AM','Australia':'AU','Austria':'AT','Azerbaijan':'AZ','Bahrain':'BH',
  'Bangladesh':'BD','Belgium':'BE','Benin':'BJ','Bolivia':'BO','Bosnia and Herzegovina':'BA',
  'Botswana':'BW','Brazil':'BR','Bulgaria':'BG','Burkina Faso':'BF','Burundi':'BI',
  'Cambodia':'KH','Cameroon':'CM','Canada':'CA','Cape Verde':'CV','Central African Republic':'CF',
  'Chad':'TD','Chile':'CL','China':'CN','Colombia':'CO','Congo (Kinshasa)':'CD',
  'Congo (Brazzaville)':'CG','Costa Rica':'CR','Croatia':'HR','Cuba':'CU','Cyprus':'CY',
  'Czech Republic':'CZ','Denmark':'DK','Djibouti':'DJ','Dominican Republic':'DO',
  'Ecuador':'EC','Egypt':'EG','El Salvador':'SV','Eritrea':'ER','Estonia':'EE',
  'Ethiopia':'ET','Finland':'FI','France':'FR','Gabon':'GA','Georgia':'GE',
  'Germany':'DE','Ghana':'GH','Greece':'GR','Guatemala':'GT','Guinea':'GN',
  'Haiti':'HT','Honduras':'HN','Hungary':'HU','Iceland':'IS','India':'IN',
  'Indonesia':'ID','Iran':'IR','Iraq':'IQ','Ireland':'IE','Israel':'IL',
  'Italy':'IT','Jamaica':'JM','Japan':'JP','Jordan':'JO','Kazakhstan':'KZ',
  'Kenya':'KE','Kosovo':'XK','Kuwait':'KW','Kyrgyzstan':'KG','Laos':'LA',
  'Latvia':'LV','Lebanon':'LB','Liberia':'LR','Libya':'LY','Lithuania':'LT',
  'Luxembourg':'LU','Madagascar':'MG','Malawi':'MW','Malaysia':'MY','Mali':'ML',
  'Malta':'MT','Mauritania':'MR','Mauritius':'MU','Mexico':'MX','Moldova':'MD',
  'Mongolia':'MN','Montenegro':'ME','Morocco':'MA','Mozambique':'MZ','Myanmar':'MM',
  'Namibia':'NA','Nepal':'NP','Netherlands':'NL','New Zealand':'NZ','Nicaragua':'NI',
  'Niger':'NE','Nigeria':'NG','Norway':'NO','Oman':'OM','Pakistan':'PK',
  'Panama':'PA','Papua New Guinea':'PG','Paraguay':'PY','Peru':'PE','Philippines':'PH',
  'Poland':'PL','Portugal':'PT','Qatar':'QA','Romania':'RO','Russia':'RU',
  'Rwanda':'RW','Saudi Arabia':'SA','Senegal':'SN','Serbia':'RS','Sierra Leone':'SL',
  'Slovakia':'SK','Slovenia':'SI','Somalia':'SO','South Africa':'ZA','South Korea':'KR',
  'South Sudan':'SS','Spain':'ES','Sri Lanka':'LK','Sudan':'SD','Sweden':'SE',
  'Switzerland':'CH','Syria':'SY','Taiwan':'TW','Tajikistan':'TJ','Tanzania':'TZ',
  'Thailand':'TH','Togo':'TG','Trinidad and Tobago':'TT','Tunisia':'TN','Turkey':'TR',
  'Turkmenistan':'TM','Uganda':'UG','Ukraine':'UA','United Arab Emirates':'AE',
  'United Kingdom':'GB','United States':'US','Uruguay':'UY','Uzbekistan':'UZ',
  'Venezuela':'VE','Vietnam':'VN','Yemen':'YE','Zambia':'ZM','Zimbabwe':'ZW',
  "Cote d'Ivoire":'CI',"Côte d'Ivoire":'CI','Guinea-Bissau':'GW','Equatorial Guinea':'GQ',
  'Sao Tome and Principe':'ST','Comoros':'KM','Seychelles':'SC','Maldives':'MV',
  'North Korea':'KP','Macau':'MO','Hong Kong':'HK','Palestinian Territory':'PS',
  'Faroe Islands':'FO','Greenland':'GL','Puerto Rico':'PR','Guadeloupe':'GP',
  'Martinique':'MQ','Reunion':'RE','New Caledonia':'NC','French Polynesia':'PF',
  'Fiji':'FJ','Vanuatu':'VU','Solomon Islands':'SB','Guam':'GU','Samoa':'WS',
  'Tonga':'TO','Kiribati':'KI','Myanmar (Burma)':'MM','Macedonia':'MK',
};

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (e) => { try { fs.unlinkSync(dest); } catch {} reject(e); });
  });
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

async function main() {
  console.log('Téléchargement OpenFlights airports.dat...');
  await download(CSV_URL, TMP_FILE);
  console.log('Téléchargement terminé. Parsing CSV...');

  const rl = readline.createInterface({ input: fs.createReadStream(TMP_FILE), crlfDelay: Infinity });

  type Row = {
    iata: string; icao: string | null;
    name: string; city: string; country: string; countryCode: string;
    lat: number; lng: number;
  };
  const batch: Row[] = [];
  let skipped = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const p = parseCsvLine(line);
    if (p.length < 8) { skipped++; continue; }

    const iata    = p[4];
    const icao    = p[5];
    const name    = p[1];
    const city    = p[2];
    const country = p[3];
    const lat     = parseFloat(p[6]);
    const lng     = parseFloat(p[7]);

    if (!iata || iata === '\\N' || !/^[A-Z]{3}$/.test(iata)) { skipped++; continue; }
    if (isNaN(lat) || isNaN(lng))                              { skipped++; continue; }
    if (!name || !city)                                        { skipped++; continue; }

    const countryCode = COUNTRY_TO_ISO[country] ?? 'XX';
    batch.push({
      iata,
      icao: (!icao || icao === '\\N') ? null : icao,
      name, city, country, countryCode, lat, lng,
    });
  }

  console.log(`${batch.length} aéroports valides, ${skipped} lignes ignorées.`);
  console.log('Import en base (upsert par lots de 200)...');

  const CHUNK = 200;
  let done = 0;
  let errors = 0;

  for (let i = 0; i < batch.length; i += CHUNK) {
    const chunk = batch.slice(i, i + CHUNK);
    await Promise.all(chunk.map(a =>
      prisma.airport.upsert({
        where: { iataCode: a.iata },
        update: {
          icaoCode: a.icao ?? undefined,
          name: a.name, city: a.city,
          country: a.country, countryCode: a.countryCode,
          latitude: a.lat, longitude: a.lng,
        },
        create: {
          iataCode: a.iata, icaoCode: a.icao ?? undefined,
          name: a.name, city: a.city,
          country: a.country, countryCode: a.countryCode,
          latitude: a.lat, longitude: a.lng,
          detectionRadius: 3,
          isActive: true,
        },
      }).catch(() => { errors++; })
    ));
    done += chunk.length;
    process.stdout.write(`\r  ${done}/${batch.length} traités...`);
  }

  // Rayon 15 km pour tous les aéroports camerounais
  const cmUpdate = await prisma.airport.updateMany({
    where: { countryCode: 'CM' },
    data: { detectionRadius: 15 },
  });
  console.log(`\nRayon 15 km appliqué à ${cmUpdate.count} aéroports camerounais.`);

  const totalInDb = await prisma.airport.count();
  console.log(`Import terminé. ${totalInDb} aéroports total en base, ${errors} erreurs.`);
  try { fs.unlinkSync(TMP_FILE); } catch {}
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

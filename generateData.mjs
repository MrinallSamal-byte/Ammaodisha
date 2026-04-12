import fs from 'fs';

const mp = {
  id: "mp-bhubaneswar",
  name: "Aparajita Sarangi",
  role: "mp",
  constituency: "Bhubaneswar",
  party: "BJP",
  party_full: "Bharatiya Janata Party",
  active: true,
  photo_url: "https://upload.wikimedia.org/wikipedia/commons/1/14/Aparajita_Sarangi.jpg"
};

const mlas = [
  {
    id: "mla-113",
    name: "Susant Kumar Rout",
    role: "mla",
    constituency: "Bhubaneswar North (Uttar)",
    party: "BJD",
    party_full: "Biju Janata Dal",
    active: true,
    photo_url: ""
  },
  {
    id: "mla-112",
    name: "Ananta Narayan Jena",
    role: "mla",
    constituency: "Bhubaneswar Central (Madhya)",
    party: "BJD",
    party_full: "Biju Janata Dal",
    active: true,
    photo_url: ""
  },
  {
    id: "mla-114",
    name: "Babu Singh",
    role: "mla",
    constituency: "Ekamra-Bhubaneswar",
    party: "BJP",
    party_full: "Bharatiya Janata Party",
    active: true,
    photo_url: ""
  },
  {
    id: "mla-115",
    name: "Bibhuti Bhusan Balabantaray",
    role: "mla",
    constituency: "Jatani",
    party: "BJD",
    party_full: "Biju Janata Dal",
    active: true,
    photo_url: ""
  }
];

fs.writeFileSync("/home/mrinall-samal/Projects/Live Garbage 3/public/representatives.json", JSON.stringify([mp, ...mlas], null, 2));

const bmc_wards_config = {
  "Bhubaneswar North (Uttar)": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13],
  "Bhubaneswar Central (Madhya)": [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 35, 36, 37],
  "Ekamra-Bhubaneswar": [12, 14, 15, 30, 31, 32, 33, 34, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47]
};

const wards = [];
for (let i = 1; i <= 67; i++) {
  let constituency = null;
  for (const [name, arr] of Object.entries(bmc_wards_config)) {
    if (arr.includes(i)) {
      constituency = name;
      break;
    }
  }

  wards.push({
    ward_number: i,
    ward_name: `Ward ${i}`,
    zone: "N/A",
    assembly_constituency: constituency || "Unknown",
    parliamentary_constituency: "Bhubaneswar",
    center_lat: "20.2961",
    center_lng: "85.8245",
    locality_name: ""
  });
}

fs.writeFileSync("/home/mrinall-samal/Projects/Live Garbage 3/public/wards.json", JSON.stringify(wards, null, 2));

console.log('JSON files generated successfully!');

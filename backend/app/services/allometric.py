"""
Tablas alométricas para estimación de biomasa y edad.
Basadas en publicaciones INTA Argentina y FAO 2012.
Referencia: INTA - Modelos alométricos para especies forestales de Argentina
"""
from typing import Tuple

# Reglas de clasificación de especie por color RGB (valores normalizados 0-255)
# Formato: (r_min, r_max, g_min, g_max, b_min, b_max)
SPECIES_COLOR_RULES = {
    "eucalipto": {
        "r_range": (50, 120),
        "g_range": (80, 160),
        "b_range": (30, 100),
        "g_dominance": True,   # g > r y g > b
        "texture_range": (0.3, 0.7),  # textura media (follaje fino)
        "source": "INTA 2019 - Eucalyptus globulus",
    },
    "pino": {
        "r_range": (40, 100),
        "g_range": (60, 130),
        "b_range": (20, 80),
        "g_dominance": True,
        "texture_range": (0.5, 0.9),  # textura alta (agujas)
        "source": "INTA 2018 - Pinus radiata",
    },
    "quebracho": {
        "r_range": (80, 160),
        "g_range": (70, 140),
        "b_range": (30, 90),
        "g_dominance": False,  # tonos más amarronados
        "texture_range": (0.4, 0.8),
        "source": "INTA 2020 - Schinopsis lorentzii",
    },
    "algarrobo": {
        "r_range": (60, 140),
        "g_range": (80, 150),
        "b_range": (20, 80),
        "g_dominance": True,
        "texture_range": (0.2, 0.6),  # copa más abierta
        "source": "INTA 2017 - Prosopis alba",
    },
    "araucaria": {
        "r_range": (30, 90),
        "g_range": (50, 110),
        "b_range": (20, 70),
        "g_dominance": True,
        "texture_range": (0.6, 0.95),  # muy rugosa
        "source": "INTA 2021 - Araucaria araucana",
    },
}

# Coeficientes alométricos: biomasa_kg = a * (height_m ^ b) * (crown_area_m2 ^ c)
# Basados en modelos INTA y FAO para plantaciones sudamericanas
ALLOMETRIC_COEFFICIENTS = {
    "eucalipto":  {"a": 45.2,  "b": 1.8, "c": 0.6, "age_slope": 0.12},
    "pino":       {"a": 38.7,  "b": 1.9, "c": 0.55, "age_slope": 0.10},
    "quebracho":  {"a": 62.1,  "b": 1.6, "c": 0.7, "age_slope": 0.07},
    "algarrobo":  {"a": 28.4,  "b": 1.7, "c": 0.65, "age_slope": 0.08},
    "araucaria":  {"a": 71.3,  "b": 1.5, "c": 0.8, "age_slope": 0.06},
    "desconocida":{"a": 40.0,  "b": 1.7, "c": 0.6, "age_slope": 0.10},
}

def classify_species(r_mean: float, g_mean: float, b_mean: float, texture_score: float) -> Tuple[str, str]:
    """
    Clasifica la especie del árbol basándose en el perfil de color RGB y textura.
    Retorna: (especie, confianza: bajo|medio|alto)
    """
    best_species = "desconocida"
    best_score = 0.0

    for species, rules in SPECIES_COLOR_RULES.items():
        score = 0.0
        checks = 0

        # Check rangos R, G, B
        if rules["r_range"][0] <= r_mean <= rules["r_range"][1]:
            score += 1
        checks += 1

        if rules["g_range"][0] <= g_mean <= rules["g_range"][1]:
            score += 1
        checks += 1

        if rules["b_range"][0] <= b_mean <= rules["b_range"][1]:
            score += 1
        checks += 1

        # Check dominancia verde
        if rules["g_dominance"]:
            if g_mean > r_mean and g_mean > b_mean:
                score += 1
        else:
            if r_mean >= g_mean:
                score += 1
        checks += 1

        # Check textura
        if rules["texture_range"][0] <= texture_score <= rules["texture_range"][1]:
            score += 1
        checks += 1

        normalized_score = score / checks
        if normalized_score > best_score:
            best_score = normalized_score
            best_species = species

    # Determinar confianza
    if best_score >= 0.8:
        confidence = "alto"
    elif best_score >= 0.5:
        confidence = "medio"
    else:
        confidence = "bajo"
        best_species = "desconocida"

    return best_species, confidence

def estimate_biomass(species: str, height_m: float, crown_area_m2: float) -> float:
    """Estima biomasa en kg usando ecuaciones alométricas."""
    coef = ALLOMETRIC_COEFFICIENTS.get(species, ALLOMETRIC_COEFFICIENTS["desconocida"])
    biomass = coef["a"] * (height_m ** coef["b"]) * (crown_area_m2 ** coef["c"])
    return round(max(biomass, 1.0), 2)

def estimate_age(species: str, height_m: float) -> int:
    """Estima edad aproximada en años basándose en altura y especie."""
    coef = ALLOMETRIC_COEFFICIENTS.get(species, ALLOMETRIC_COEFFICIENTS["desconocida"])
    # Modelo lineal simple: age = height / growth_rate_per_year
    # Tasa de crecimiento anual típica: eucalipto ~2m/año, quebracho ~0.5m/año
    growth_rates = {
        "eucalipto": 2.0,
        "pino": 1.5,
        "quebracho": 0.6,
        "algarrobo": 0.8,
        "araucaria": 0.5,
        "desconocida": 1.0,
    }
    rate = growth_rates.get(species, 1.0)
    age = int(height_m / rate)
    return max(age, 1)

def get_allometric_source(species: str) -> str:
    rules = SPECIES_COLOR_RULES.get(species)
    if rules:
        return rules["source"]
    return "FAO 2012 - Modelo genérico"

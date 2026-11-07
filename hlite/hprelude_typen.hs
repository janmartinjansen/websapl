-- micro_haskell/hlite/hprelude_typen.hs -- de typen van de Prelude van
-- Haskell lite (hprelude.spp), voor de typechecker (typen.spp, H1).
-- Gelezen door de eigen parser. De standaardklassen staan hier als class
-- (H3); hun instances voor Int, Char, (), lijsten en tupels zijn ingebouwd in
-- typen.spp (Int is het enige getaltype), de rest via deriving of instance. Elke naam die een programma uit de
-- Prelude mag gebruiken, staat hier. De overladen functies (met Eq, Ord,
-- Show of Enum) hebben onderaan een body in Haskell lite: die worden per
-- type gespecialiseerd, net als die van het programma (H2b). De rest is
-- in Sapl (hprelude.spp).
module Prelude where

data Bool = False | True deriving (Eq, Ord, Show, Enum)
data Maybe a = Nothing | Just a deriving (Eq, Ord, Show)
data Either a b = Left a | Right b deriving (Eq, Ord, Show)
data Ordering = LT | EQ | GT deriving (Eq, Ord, Show, Enum)

(:) :: a -> [a] -> [a]

-- == De standaardklassen ==

class Eq a where
  (==), (/=) :: a -> a -> Bool
  x /= y = not (x == y)
  x == y = not (x /= y)

class Eq a => Ord a where
  compare :: a -> a -> Ordering
  (<), (<=), (>), (>=) :: a -> a -> Bool
  max, min :: a -> a -> a
  compare x y = if x == y then EQ else if x <= y then LT else GT
  x < y = case compare x y of { LT -> True ; _ -> False }
  x <= y = case compare x y of { GT -> False ; _ -> True }
  x > y = case compare x y of { GT -> True ; _ -> False }
  x >= y = case compare x y of { LT -> False ; _ -> True }
  max x y = if x <= y then y else x
  min x y = if x <= y then x else y

class Show a where
  show :: a -> String

class Num a where
  (+), (-), (*) :: a -> a -> a
  negate, abs, signum :: a -> a
  fromInteger :: Int -> a

class (Num a, Ord a) => Real a

class (Real a, Enum a) => Integral a where
  quot, rem, div, mod :: a -> a -> a
  divMod, quotRem :: a -> a -> (a, a)
  toInteger :: a -> Int

class Num a => Fractional a where
  (/) :: a -> a -> a
  recip :: a -> a

class Fractional a => Floating a where
  pi :: a
  exp, log, sqrt, sin, cos, tan, asin, acos, atan :: a -> a
  (**), logBase :: a -> a -> a

class (Real a, Fractional a) => RealFrac a where
  truncate, round, ceiling, floor :: Integral b => a -> b

realToFrac :: (Real a, Fractional b) => a -> b

-- read (Int en Double; typgebruik.spp kiest hp_readInt of hp_readD)
class Read a where
  read :: String -> a

class Enum a where
  succ, pred :: a -> a
  toEnum :: Int -> a
  fromEnum :: a -> Int
  enumFrom :: a -> [a]
  enumFromTo, enumFromThen :: a -> a -> [a]
  enumFromThenTo :: a -> a -> a -> [a]

gcd, lcm :: Integral a => a -> a -> a

-- Functor, Applicative, Monad (H4, 7 november 2026): klassen over een
-- typeconstructor. Instances voor Maybe, [], Either e en IO (en Functor
-- voor Map); mapM, when, ... werken in elke monade, over lijsten (geen
-- Foldable/Traversable).
class Functor f where
  fmap :: (a -> b) -> f a -> f b
  (<$) :: a -> f b -> f a
  x <$ m = fmap (const x) m

class Functor f => Applicative f where
  pure :: a -> f a
  (<*>) :: f (a -> b) -> f a -> f b
  (*>) :: f a -> f b -> f b
  a *> b = fmap (const id) a <*> b
  (<*) :: f a -> f b -> f a
  a <* b = fmap const a <*> b

class Applicative m => Monad m where
  (>>=) :: m a -> (a -> m b) -> m b
  (>>) :: m a -> m b -> m b
  m >> k = m >>= \_ -> k
  return :: a -> m a
  return x = pure x

class Monad m => MonadFail m where
  fail :: String -> m a

instance Functor Maybe where
  fmap f Nothing = Nothing
  fmap f (Just x) = Just (f x)

instance Applicative Maybe where
  pure x = Just x
  Nothing <*> m = Nothing
  Just f <*> m = fmap f m

instance Monad Maybe where
  Nothing >>= k = Nothing
  Just x >>= k = k x

instance MonadFail Maybe where
  fail s = Nothing

instance Functor [] where
  fmap f xs = map f xs

instance Applicative [] where
  pure x = [x]
  fs <*> xs = [f x | f <- fs, x <- xs]

instance Monad [] where
  xs >>= k = concatMap k xs

instance MonadFail [] where
  fail s = []

instance Functor (Either e) where
  fmap f (Left e) = Left e
  fmap f (Right x) = Right (f x)

instance Applicative (Either e) where
  pure x = Right x
  Left e <*> m = Left e
  Right f <*> m = fmap f m

instance Monad (Either e) where
  Left e >>= k = Left e
  Right x >>= k = k x

-- IO: de methoden roepen de primitieven van hprelude.spp aan.
ioReturn :: a -> IO a
ioBind :: IO a -> (a -> IO b) -> IO b
ioThen :: IO a -> IO b -> IO b

instance Functor IO where
  fmap f m = ioBind m (\x -> ioReturn (f x))

instance Applicative IO where
  pure x = ioReturn x
  mf <*> mx = ioBind mf (\f -> ioBind mx (\x -> ioReturn (f x)))

instance Monad IO where
  m >>= k = ioBind m k
  m >> k = ioThen m k
  return x = ioReturn x

instance MonadFail IO where
  fail s = error s

(<$>) :: Functor f => (a -> b) -> f a -> f b
f <$> x = fmap f x

(=<<) :: Monad m => (a -> m b) -> m a -> m b
f =<< m = m >>= f

(>=>) :: Monad m => (a -> m b) -> (b -> m c) -> a -> m c
f >=> g = \x -> f x >>= g

liftA2 :: Applicative f => (a -> b -> c) -> f a -> f b -> f c
liftA2 f a b = fmap f a <*> b

join :: Monad m => m (m a) -> m a
join mm = mm >>= id

void :: Functor f => f a -> f ()
void m = fmap (const ()) m

mapM :: Monad m => (a -> m b) -> [a] -> m [b]
mapM f [] = return []
mapM f (x : xs) = f x >>= \y -> mapM f xs >>= \ys -> return (y : ys)

traverse :: Applicative f => (a -> f b) -> [a] -> f [b]
traverse f [] = pure []
traverse f (x : xs) = liftA2 (:) (f x) (traverse f xs)

forM :: Monad m => [a] -> (a -> m b) -> m [b]
forM xs f = mapM f xs

sequence :: Monad m => [m a] -> m [a]
sequence ms = mapM id ms

mapM_ :: Monad m => (a -> m b) -> [a] -> m ()
mapM_ f [] = return ()
mapM_ f (x : xs) = f x >> mapM_ f xs

forM_ :: Monad m => [a] -> (a -> m b) -> m ()
forM_ xs f = mapM_ f xs

sequence_ :: Monad m => [m a] -> m ()
sequence_ ms = mapM_ id ms

when :: Applicative f => Bool -> f () -> f ()
when c m = if c then m else pure ()

unless :: Applicative f => Bool -> f () -> f ()
unless c m = if c then pure () else m

replicateM :: Applicative f => Int -> f a -> f [a]
replicateM n m = if n <= 0 then pure [] else liftA2 (:) m (replicateM (n - 1) m)

replicateM_ :: Applicative f => Int -> f a -> f ()
replicateM_ n m = if n <= 0 then pure () else m *> replicateM_ (n - 1) m

foldM :: Monad m => (b -> a -> m b) -> b -> [a] -> m b
foldM f z [] = return z
foldM f z (x : xs) = f z x >>= \z2 -> foldM f z2 xs

zipWithM :: Applicative f => (a -> b -> f c) -> [a] -> [b] -> f [c]
zipWithM f xs ys = sequenceA (zipWith f xs ys)

zipWithM_ :: Applicative f => (a -> b -> f c) -> [a] -> [b] -> f ()
zipWithM_ f xs ys = sequenceA_ (zipWith f xs ys)

sequenceA :: Applicative f => [f a] -> f [a]
sequenceA ms = traverse id ms

sequenceA_ :: Applicative f => [f a] -> f ()
sequenceA_ [] = pure ()
sequenceA_ (m : ms) = m *> sequenceA_ ms

-- IO
putStr :: String -> IO ()
putStrLn :: String -> IO ()
print :: Show a => a -> IO ()
putChar :: Char -> IO ()

-- functies
id :: a -> a
const :: a -> b -> a
flip :: (a -> b -> c) -> b -> a -> c
(.) :: (b -> c) -> (a -> b) -> a -> c
($) :: (a -> b) -> a -> b
($!) :: (a -> b) -> a -> b
seq :: a -> b -> b
fst :: (a, b) -> a
snd :: (a, b) -> b
curry :: ((a, b) -> c) -> a -> b -> c
uncurry :: (a -> b -> c) -> (a, b) -> c
not :: Bool -> Bool
otherwise :: Bool
until :: (a -> Bool) -> (a -> a) -> a -> a
error :: String -> a
undefined :: a
maybe :: b -> (a -> b) -> Maybe a -> b
either :: (a -> c) -> (b -> c) -> Either a b -> c

-- getallen en tekens
(&&), (||) :: Bool -> Bool -> Bool
(^) :: (Num a, Integral b) => a -> b -> a
subtract :: Num a => a -> a -> a
fromIntegral :: (Integral a, Num b) => a -> b
even, odd :: Integral a => a -> Bool
ord :: Char -> Int
chr :: Int -> Char
isDigit, isUpper, isLower, isAlpha, isAlphaNum, isSpace :: Char -> Bool
toUpper, toLower :: Char -> Char
digitToInt :: Char -> Int

-- lijsten
(++) :: [a] -> [a] -> [a]
map :: (a -> b) -> [a] -> [b]
filter :: (a -> Bool) -> [a] -> [a]
foldr :: (a -> b -> b) -> b -> [a] -> b
foldl, foldl' :: (b -> a -> b) -> b -> [a] -> b
foldr1, foldl1 :: (a -> a -> a) -> [a] -> a
sum, product :: Num a => [a] -> a
length :: [a] -> Int
concat :: [[a]] -> [a]
concatMap :: (a -> [b]) -> [a] -> [b]
take, drop :: Int -> [a] -> [a]
splitAt :: Int -> [a] -> ([a], [a])
head, last :: [a] -> a
tail, init, reverse :: [a] -> [a]
null :: [a] -> Bool
zip :: [a] -> [b] -> [(a, b)]
zip3 :: [a] -> [b] -> [c] -> [(a, b, c)]
zipWith :: (a -> b -> c) -> [a] -> [b] -> [c]
unzip :: [(a, b)] -> ([a], [b])
replicate :: Int -> a -> [a]
iterate :: (a -> a) -> a -> [a]
repeat :: a -> [a]
cycle :: [a] -> [a]
takeWhile, dropWhile :: (a -> Bool) -> [a] -> [a]
span, break :: (a -> Bool) -> [a] -> ([a], [a])
and, or :: [Bool] -> Bool
any, all :: (a -> Bool) -> [a] -> Bool
(!!) :: [a] -> Int -> a
lines, words :: String -> [String]
unlines, unwords :: [String] -> String

-- == Overladen functies met een body (H2b) ==

elem :: Eq a => a -> [a] -> Bool
elem x [] = False
elem x (y : ys) = x == y || elem x ys

notElem :: Eq a => a -> [a] -> Bool
notElem x ys = not (elem x ys)

lookup :: Eq a => a -> [(a, b)] -> Maybe b
lookup k [] = Nothing
lookup k ((a, b) : rest) = if k == a then Just b else lookup k rest

maximum :: Ord a => [a] -> a
maximum (x : xs) = foldl' max x xs

minimum :: Ord a => [a] -> a
minimum (x : xs) = foldl' min x xs

nub :: Eq a => [a] -> [a]
nub [] = []
nub (x : xs) = x : nub (filter (/= x) xs)

-- == Data.List, Data.Maybe, Data.Ord, Data.Function (in Haskell lite) ==
-- Ook een functie zonder klasse komt alleen in het programma als het haar
-- gebruikt (als kopie f__, typgebruik.spp).

sortBy :: (a -> a -> Ordering) -> [a] -> [a]
sortBy cmp xs = mergeAll (map (\x -> [x]) xs)
  where
    mergeAll [] = []
    mergeAll [ys] = ys
    mergeAll yss = mergeAll (mergePairs yss)
    mergePairs (a : b : rest) = merge a b : mergePairs rest
    mergePairs yss = yss
    merge [] bs = bs
    merge as [] = as
    merge (a : as) (b : bs) = case cmp a b of
      GT -> b : merge (a : as) bs
      _ -> a : merge as (b : bs)

sort :: Ord a => [a] -> [a]
sort xs = sortBy compare xs

sortOn :: Ord b => (a -> b) -> [a] -> [a]
sortOn f xs = map snd (sortBy (\a b -> compare (fst a) (fst b)) [(f x, x) | x <- xs])

insertBy :: (a -> a -> Ordering) -> a -> [a] -> [a]
insertBy cmp x [] = [x]
insertBy cmp x (y : ys) = case cmp x y of
  GT -> y : insertBy cmp x ys
  _ -> x : y : ys

insert :: Ord a => a -> [a] -> [a]
insert x ys = insertBy compare x ys

comparing :: Ord b => (a -> b) -> a -> a -> Ordering
comparing f a b = compare (f a) (f b)

on :: (b -> b -> c) -> (a -> b) -> a -> a -> c
on g f a b = g (f a) (f b)

maximumBy :: (a -> a -> Ordering) -> [a] -> a
maximumBy cmp (x : xs) = foldl (\m y -> case cmp y m of { LT -> m ; _ -> y }) x xs

minimumBy :: (a -> a -> Ordering) -> [a] -> a
minimumBy cmp (x : xs) = foldl (\m y -> case cmp y m of { LT -> y ; _ -> m }) x xs

groupBy :: (a -> a -> Bool) -> [a] -> [[a]]
groupBy eq [] = []
groupBy eq (x : xs) = (x : ys) : groupBy eq zs
  where (ys, zs) = span (eq x) xs

group :: Eq a => [a] -> [[a]]
group xs = groupBy (==) xs

partition :: (a -> Bool) -> [a] -> ([a], [a])
partition p xs = (filter p xs, filter (not . p) xs)

isPrefixOf :: Eq a => [a] -> [a] -> Bool
isPrefixOf [] ys = True
isPrefixOf (x : xs) [] = False
isPrefixOf (x : xs) (y : ys) = x == y && isPrefixOf xs ys

isSuffixOf :: Eq a => [a] -> [a] -> Bool
isSuffixOf xs ys = isPrefixOf (reverse xs) (reverse ys)

isInfixOf :: Eq a => [a] -> [a] -> Bool
isInfixOf xs ys = any (isPrefixOf xs) (tails ys)

stripPrefix :: Eq a => [a] -> [a] -> Maybe [a]
stripPrefix [] ys = Just ys
stripPrefix (x : xs) (y : ys) = if x == y then stripPrefix xs ys else Nothing
stripPrefix xs [] = Nothing

intersperse :: a -> [a] -> [a]
intersperse sep [] = []
intersperse sep (x : xs) = x : go xs
  where
    go [] = []
    go (y : ys) = sep : y : go ys

intercalate :: [a] -> [[a]] -> [a]
intercalate sep xss = concat (intersperse sep xss)

transpose :: [[a]] -> [[a]]
transpose [] = []
transpose ([] : xss) = transpose xss
transpose ((x : xs) : xss) = (x : [h | (h : _) <- xss]) : transpose (xs : [t | (_ : t) <- xss])

zipWith3 :: (a -> b -> c -> d) -> [a] -> [b] -> [c] -> [d]
zipWith3 f (a : as) (b : bs) (c : cs) = f a b c : zipWith3 f as bs cs
zipWith3 f as bs cs = []

unzip3 :: [(a, b, c)] -> ([a], [b], [c])
unzip3 xs = (map (\(a, b, c) -> a) xs, map (\(a, b, c) -> b) xs, map (\(a, b, c) -> c) xs)

scanl :: (b -> a -> b) -> b -> [a] -> [b]
scanl f q xs = q : (case xs of
  [] -> []
  (y : ys) -> scanl f (f q y) ys)

scanl1 :: (a -> a -> a) -> [a] -> [a]
scanl1 f (x : xs) = scanl f x xs
scanl1 f [] = []

scanr :: (a -> b -> b) -> b -> [a] -> [b]
scanr f q0 [] = [q0]
scanr f q0 (x : xs) = case scanr f q0 xs of
  qs@(q : _) -> f x q : qs

tails :: [a] -> [[a]]
tails [] = [[]]
tails (x : xs) = (x : xs) : tails xs

inits :: [a] -> [[a]]
inits [] = [[]]
inits (x : xs) = [] : map (x :) (inits xs)

subsequences :: [a] -> [[a]]
subsequences xs = [] : nonEmpty xs
  where
    nonEmpty [] = []
    nonEmpty (y : ys) = [y] : foldr (\zs r -> zs : (y : zs) : r) [] (nonEmpty ys)

-- Het algoritme van GHC (Data.List), voor dezelfde volgorde.
permutations :: [a] -> [[a]]
permutations xs0 = xs0 : permsGo xs0 []

permsGo :: [a] -> [a] -> [[a]]
permsGo [] is = []
permsGo (t : ts) is = foldr (permsIl t ts) (permsGo ts (t : is)) (permutations is)

permsIl :: a -> [a] -> [a] -> [[a]] -> [[a]]
permsIl t ts xs r = snd (permsIl2 t ts id xs r)

permsIl2 :: a -> [a] -> ([a] -> b) -> [a] -> [b] -> ([a], [b])
permsIl2 t ts f [] r = (ts, r)
permsIl2 t ts f (y : ys) r = let (us, zs) = permsIl2 t ts (f . (y :)) ys r in (y : us, f (t : y : us) : zs)

find :: (a -> Bool) -> [a] -> Maybe a
find p [] = Nothing
find p (x : xs) = if p x then Just x else find p xs

findIndex :: (a -> Bool) -> [a] -> Maybe Int
findIndex p xs = go 0 xs
  where
    go i [] = Nothing
    go i (y : ys) = if p y then Just i else go (i + 1) ys

elemIndex :: Eq a => a -> [a] -> Maybe Int
elemIndex x xs = findIndex (== x) xs

delete :: Eq a => a -> [a] -> [a]
delete x [] = []
delete x (y : ys) = if x == y then ys else y : delete x ys

union :: Eq a => [a] -> [a] -> [a]
union xs ys = xs ++ foldl (flip delete) (nub ys) xs

intersect :: Eq a => [a] -> [a] -> [a]
intersect xs ys = [x | x <- xs, x `elem` ys]

fromMaybe :: a -> Maybe a -> a
fromMaybe d Nothing = d
fromMaybe d (Just x) = x

isJust :: Maybe a -> Bool
isJust (Just x) = True
isJust Nothing = False

isNothing :: Maybe a -> Bool
isNothing m = not (isJust m)

catMaybes :: [Maybe a] -> [a]
catMaybes ms = [x | Just x <- ms]

mapMaybe :: (a -> Maybe b) -> [a] -> [b]
mapMaybe f xs = [y | Just y <- map f xs]

fromJust :: Maybe a -> a
fromJust (Just x) = x

-- == Weergave in de notebook (7 november 2026) =============================
-- Een cel met een waarde van type Display toont een tabel, Markdown of een
-- plaatje: show geeft het @@-protocol van de notebookpagina
-- (lib/notebook_glue.cfp, websapl/js/notebook_core.js). Plaatjes in
-- WebSapl's coördinaten: x en y van -1.0 tot 1.0, (0,0) in het midden. De
-- vormen alleen via functies (disc, rect, ...): een eigen
-- data Shape = Rectangle ... van het programma botst dan niet.
data Display = DText String | DMarkdown String | DTable [String] [[String]] | DGraphics [GShape] | DColumn [Display]

data GShape = GText Int (Double, Double) String | GPolyLine Int [(Double, Double)] | GPolygon Int [(Double, Double)]
            | GRect Int (Double, Double) (Double, Double) | GEllipse Int (Double, Double) (Double, Double)
            | GDisc Int (Double, Double) (Double, Double)

instance Show Display where
  show d = displayText d

text :: String -> Display
text s = DText s

markdown :: String -> Display
markdown s = DMarkdown s

-- table ["x", "x^2"] [[show x, show (x*x)] | x <- [1..5]]
table :: [String] -> [[String]] -> Display
table hs rows = DTable hs rows

-- Meer weergaven onder elkaar.
column :: [Display] -> Display
column ds = DColumn ds

picture :: [GShape] -> Display
picture gs = DGraphics gs

-- De vormen: een kleur (black, red, ...), punten (x, y).
disc :: Int -> (Double, Double) -> Double -> GShape
disc c (x, y) r = GDisc c (x - r, y - r) (x + r, y + r)

circle :: Int -> (Double, Double) -> Double -> GShape
circle c (x, y) r = GEllipse c (x - r, y - r) (x + r, y + r)

rect :: Int -> (Double, Double) -> (Double, Double) -> GShape
rect c p q = GRect c p q

filledRect :: Int -> (Double, Double) -> (Double, Double) -> GShape
filledRect c (x0, y0) (x1, y1) = GPolygon c [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

ellipse :: Int -> (Double, Double) -> (Double, Double) -> GShape
ellipse c p q = GEllipse c p q

line :: Int -> [(Double, Double)] -> GShape
line c ps = GPolyLine c ps

polygon :: Int -> [(Double, Double)] -> GShape
polygon c ps = GPolygon c ps

textAt :: Int -> (Double, Double) -> String -> GShape
textAt c p s = GText c p s

black, blue, green, cyan, red, magenta, brown, lightGray, darkGray, brightBlue, brightGreen, brightCyan, brightRed, brightMagenta, yellow, white :: Int
black = 0
blue = 1
green = 2
cyan = 3
red = 4
magenta = 5
brown = 6
lightGray = 7
darkGray = 8
brightBlue = 9
brightGreen = 10
brightCyan = 11
brightRed = 12
brightMagenta = 13
yellow = 14
white = 15

-- Staafdiagram van getallen (niet negatief), Int of Double.
bar :: Real a => [a] -> Display
bar vs = DGraphics (chartBase : barsFrom 0 (length vs) (chartMax fs) fs)
  where fs = map realToFrac vs

-- Lijngrafiek van getallen, gelijke afstand op de x-as.
lineChart :: Real a => [a] -> Display
lineChart vs = DGraphics [chartBase, GPolyLine 11 (zipWith (linePoint (length fs) (chartMin fs) (chartMax fs)) [0 ..] fs)]
  where fs = map realToFrac vs

-- Lijngrafiek van punten (x, y), geschaald naar het vlak.
plot :: [(Double, Double)] -> Display
plot ps = DGraphics [chartBase, GPolyLine 11 (map (plotPoint (chartMin xs) (chartMax xs) (chartMin ys) (chartMax ys)) ps)]
  where xs = map fst ps
        ys = map snd ps

chartBase :: GShape
chartBase = GPolyLine 7 [(-0.9, -0.9), (0.9, -0.9)]

chartMax :: [Double] -> Double
chartMax [] = 1.0
chartMax xs = maximum xs

chartMin :: [Double] -> Double
chartMin [] = 0.0
chartMin xs = minimum xs

barsFrom :: Int -> Int -> Double -> [Double] -> [GShape]
barsFrom i n m [] = []
barsFrom i n m (v : vs) = barAt i n m v : barsFrom (i + 1) n m vs

barAt :: Int -> Int -> Double -> Double -> GShape
barAt i n m v = GPolygon 9 [(x0, -0.9), (x1, -0.9), (x1, -0.9 + h), (x0, -0.9 + h)]
  where w = 1.8 / fromIntegral n
        x0 = -0.9 + fromIntegral i * w + w * 0.1
        x1 = x0 + w * 0.8
        h = if m > 0.0 then 1.8 * (v / m) else 0.0

linePoint :: Int -> Double -> Double -> Int -> Double -> (Double, Double)
linePoint n lo hi i v = (x, y)
  where x = if n > 1 then -0.9 + 1.8 * (fromIntegral i / fromIntegral (n - 1)) else 0.0
        y = if hi > lo then -0.9 + 1.8 * ((v - lo) / (hi - lo)) else 0.0

plotPoint :: Double -> Double -> Double -> Double -> (Double, Double) -> (Double, Double)
plotPoint x0 x1 y0 y1 (x, y) = (sc x0 x1 x, sc y0 y1 y)
  where sc a b v = if b > a then -0.9 + 1.8 * ((v - a) / (b - a)) else 0.0

-- Elk blok eindigt met de regel @@/ (daarna weer gewone uitvoer).
displayText :: Display -> String
displayText (DText s) = "@@text\n" ++ s ++ "\n@@/"
displayText (DMarkdown s) = "@@markdown\n" ++ s ++ "\n@@/"
displayText (DTable hs rows) = "@@table\n" ++ intercalate "\n" (map tableRow (hs : take 500 rows)) ++ (if null (drop 500 rows) then "" else "\n...") ++ "\n@@/"
displayText (DGraphics gs) = "@@graphics\n" ++ concatMap shapeText gs ++ "\n@@/"
displayText (DColumn ds) = intercalate "\n" (map displayText ds)

tableRow :: [String] -> String
tableRow cs = intercalate "\t" (map (map plainChar) cs)

plainChar :: Char -> Char
plainChar c = if c == '\t' || c == '\n' then ' ' else c

shapeText :: GShape -> String
shapeText (GText c p s) = "GraphText" ++ shapeCol c ++ ptText p ++ "\"" ++ map noQuote s ++ "\" "
shapeText (GPolyLine c ps) = "GraphPolyLine" ++ shapeCol c ++ ptsText ps
shapeText (GPolygon c ps) = "GraphPolygon" ++ shapeCol c ++ ptsText ps
shapeText (GRect c p q) = "GraphRectangle" ++ shapeCol c ++ ptText p ++ ptText q
shapeText (GEllipse c p q) = "GraphEllipse" ++ shapeCol c ++ ptText p ++ ptText q
shapeText (GDisc c p q) = "GraphDisc" ++ shapeCol c ++ ptText p ++ ptText q

shapeCol :: Int -> String
shapeCol c = " " ++ show c ++ " "

noQuote :: Char -> Char
noQuote c = if c == '"' then '\'' else c

ptsText :: [(Double, Double)] -> String
ptsText ps = show (length ps) ++ " " ++ concatMap ptText ps

ptText :: (Double, Double) -> String
ptText (x, y) = show x ++ " " ++ show y ++ " "

-- == Data.Map en Data.Set (7 november 2026) ================================
-- Een gewichtsgebalanceerde boom zoals in containers (delta 3, ratio 2),
-- sleutel- en ruggengraatstrikt, waarden lui (Data.Map.Lazy). De namen zijn
-- intern: modulen.spp maakt van M.insert (import qualified Data.Map as M)
-- map_insert, van M.Map Map_, en van een naam in een importlijst
-- (import Data.Map (Map, fromList)) een alias. Set_ is een Map_ a ().
data Map_ k v = MTip_ | MBin_ Int k v (Map_ k v) (Map_ k v)
data Set_ a = MSet_ (Map_ a ())

instance (Show k, Show v) => Show (Map_ k v) where
  show m = "fromList " ++ show (map_toList m)

instance (Eq k, Eq v) => Eq (Map_ k v) where
  a == b = map_toList a == map_toList b

instance (Ord k, Ord v) => Ord (Map_ k v) where
  compare a b = compare (map_toList a) (map_toList b)

instance Functor (Map_ k) where
  fmap f m = map_map f m

instance Show a => Show (Set_ a) where
  show s = "fromList " ++ show (set_toList s)

instance Eq a => Eq (Set_ a) where
  a == b = set_toList a == set_toList b

instance Ord a => Ord (Set_ a) where
  compare a b = compare (set_toList a) (set_toList b)

map_empty :: Map_ k v
map_empty = MTip_

map_singleton :: k -> v -> Map_ k v
map_singleton k v = MBin_ 1 k v MTip_ MTip_

map_size :: Map_ k v -> Int
map_size MTip_ = 0
map_size (MBin_ n _ _ _ _) = n

map_null :: Map_ k v -> Bool
map_null MTip_ = True
map_null (MBin_ _ _ _ _ _) = False

map_lookup :: Ord k => k -> Map_ k v -> Maybe v
map_lookup k MTip_ = Nothing
map_lookup k (MBin_ _ kx x l r) = case compare k kx of
  LT -> map_lookup k l
  GT -> map_lookup k r
  EQ -> Just x

map_member :: Ord k => k -> Map_ k v -> Bool
map_member k MTip_ = False
map_member k (MBin_ _ kx _ l r) = case compare k kx of
  LT -> map_member k l
  GT -> map_member k r
  EQ -> True

map_notMember :: Ord k => k -> Map_ k v -> Bool
map_notMember k m = not (map_member k m)

map_findWithDefault :: Ord k => v -> k -> Map_ k v -> v
map_findWithDefault d k m = case map_lookup k m of
  Nothing -> d
  Just x -> x

map_bang :: Ord k => Map_ k v -> k -> v
map_bang m k = case map_lookup k m of
  Nothing -> error "Map.!: given key is not an element in the map"
  Just x -> x

map_bangq :: Ord k => Map_ k v -> k -> Maybe v
map_bangq m k = map_lookup k m

map_insert :: Ord k => k -> v -> Map_ k v -> Map_ k v
map_insert kx x MTip_ = map_singleton kx x
map_insert kx x (MBin_ n ky y l r) = case compare kx ky of
  LT -> map_balance ky y (map_insert kx x l) r
  GT -> map_balance ky y l (map_insert kx x r)
  EQ -> MBin_ n kx x l r

map_insertWith :: Ord k => (v -> v -> v) -> k -> v -> Map_ k v -> Map_ k v
map_insertWith f kx x MTip_ = map_singleton kx x
map_insertWith f kx x (MBin_ n ky y l r) = case compare kx ky of
  LT -> map_balance ky y (map_insertWith f kx x l) r
  GT -> map_balance ky y l (map_insertWith f kx x r)
  EQ -> MBin_ n kx (f x y) l r

map_insertWithKey :: Ord k => (k -> v -> v -> v) -> k -> v -> Map_ k v -> Map_ k v
map_insertWithKey f kx x m = map_insertWith (f kx) kx x m

map_delete :: Ord k => k -> Map_ k v -> Map_ k v
map_delete k MTip_ = MTip_
map_delete k (MBin_ _ kx x l r) = case compare k kx of
  LT -> map_balance kx x (map_delete k l) r
  GT -> map_balance kx x l (map_delete k r)
  EQ -> map_glue l r

map_adjust :: Ord k => (v -> v) -> k -> Map_ k v -> Map_ k v
map_adjust f k MTip_ = MTip_
map_adjust f k (MBin_ n kx x l r) = case compare k kx of
  LT -> MBin_ n kx x (map_adjust f k l) r
  GT -> MBin_ n kx x l (map_adjust f k r)
  EQ -> MBin_ n kx (f x) l r

map_alter :: Ord k => (Maybe v -> Maybe v) -> k -> Map_ k v -> Map_ k v
map_alter f k m = case f (map_lookup k m) of
  Nothing -> map_delete k m
  Just x -> map_insert k x m

map_update :: Ord k => (v -> Maybe v) -> k -> Map_ k v -> Map_ k v
map_update f k m = case map_lookup k m of
  Nothing -> m
  Just x -> case f x of
    Nothing -> map_delete k m
    Just y -> map_insert k y m

map_fromList :: Ord k => [(k, v)] -> Map_ k v
map_fromList xs = foldl' (\m (k, v) -> map_insert k v m) MTip_ xs

map_fromListWith :: Ord k => (v -> v -> v) -> [(k, v)] -> Map_ k v
map_fromListWith f xs = foldl' (\m (k, v) -> map_insertWith f k v m) MTip_ xs

map_toList :: Map_ k v -> [(k, v)]
map_toList m = map_foldrWithKey (\k v acc -> (k, v) : acc) [] m

map_toAscList :: Map_ k v -> [(k, v)]
map_toAscList m = map_toList m

map_assocs :: Map_ k v -> [(k, v)]
map_assocs m = map_toList m

map_toDescList :: Map_ k v -> [(k, v)]
map_toDescList m = map_foldlWithKey (\acc k v -> (k, v) : acc) [] m

map_keys :: Map_ k v -> [k]
map_keys m = map_foldrWithKey (\k v acc -> k : acc) [] m

map_elems :: Map_ k v -> [v]
map_elems m = map_foldrWithKey (\k v acc -> v : acc) [] m

map_foldrWithKey :: (k -> v -> b -> b) -> b -> Map_ k v -> b
map_foldrWithKey f z MTip_ = z
map_foldrWithKey f z (MBin_ _ k v l r) = map_foldrWithKey f (f k v (map_foldrWithKey f z r)) l

map_foldlWithKey :: (b -> k -> v -> b) -> b -> Map_ k v -> b
map_foldlWithKey f z MTip_ = z
map_foldlWithKey f z (MBin_ _ k v l r) = map_foldlWithKey f (f (map_foldlWithKey f z l) k v) r

map_foldr :: (v -> b -> b) -> b -> Map_ k v -> b
map_foldr f z m = map_foldrWithKey (\k v acc -> f v acc) z m

map_foldl :: (b -> v -> b) -> b -> Map_ k v -> b
map_foldl f z m = map_foldlWithKey (\acc k v -> f acc v) z m

map_foldr' :: (v -> b -> b) -> b -> Map_ k v -> b
map_foldr' f z m = map_foldr f z m

map_foldl' :: (b -> v -> b) -> b -> Map_ k v -> b
map_foldl' f z m = map_foldl f z m

map_map :: (a -> b) -> Map_ k a -> Map_ k b
map_map f MTip_ = MTip_
map_map f (MBin_ n k v l r) = MBin_ n k (f v) (map_map f l) (map_map f r)

map_mapWithKey :: (k -> a -> b) -> Map_ k a -> Map_ k b
map_mapWithKey f MTip_ = MTip_
map_mapWithKey f (MBin_ n k v l r) = MBin_ n k (f k v) (map_mapWithKey f l) (map_mapWithKey f r)

map_filter :: (v -> Bool) -> Map_ k v -> Map_ k v
map_filter p m = map_filterWithKey (\k v -> p v) m

map_filterWithKey :: (k -> v -> Bool) -> Map_ k v -> Map_ k v
map_filterWithKey p m = map_fromDistinctAscList [(k, v) | (k, v) <- map_toList m, p k v]

map_partition :: (v -> Bool) -> Map_ k v -> (Map_ k v, Map_ k v)
map_partition p m = (map_filter p m, map_filter (\v -> not (p v)) m)

map_mapMaybe :: (a -> Maybe b) -> Map_ k a -> Map_ k b
map_mapMaybe f m = map_fromDistinctAscList [(k, y) | (k, x) <- map_toList m, Just y <- [f x]]

map_union :: Ord k => Map_ k v -> Map_ k v -> Map_ k v
map_union a b = map_unionWith const a b

map_unionWith :: Ord k => (v -> v -> v) -> Map_ k v -> Map_ k v -> Map_ k v
map_unionWith f a b = map_foldlWithKey (\m k v -> map_insertWith (\new old -> f old new) k v m) a b

map_unions :: Ord k => [Map_ k v] -> Map_ k v
map_unions ms = foldl map_union MTip_ ms

map_unionsWith :: Ord k => (v -> v -> v) -> [Map_ k v] -> Map_ k v
map_unionsWith f ms = foldl (map_unionWith f) MTip_ ms

map_intersectionWith :: Ord k => (a -> b -> c) -> Map_ k a -> Map_ k b -> Map_ k c
map_intersectionWith f a b = map_fromDistinctAscList [(k, f x y) | (k, x) <- map_toList a, Just y <- [map_lookup k b]]

map_intersection :: Ord k => Map_ k a -> Map_ k b -> Map_ k a
map_intersection a b = map_filterWithKey (\k v -> map_member k b) a

map_difference :: Ord k => Map_ k a -> Map_ k b -> Map_ k a
map_difference a b = map_filterWithKey (\k v -> map_notMember k b) a

map_backslash :: Ord k => Map_ k a -> Map_ k b -> Map_ k a
map_backslash a b = map_difference a b

map_lookupMin :: Map_ k v -> Maybe (k, v)
map_lookupMin MTip_ = Nothing
map_lookupMin (MBin_ _ k v MTip_ r) = Just (k, v)
map_lookupMin (MBin_ _ k v l r) = map_lookupMin l

map_lookupMax :: Map_ k v -> Maybe (k, v)
map_lookupMax MTip_ = Nothing
map_lookupMax (MBin_ _ k v l MTip_) = Just (k, v)
map_lookupMax (MBin_ _ k v l r) = map_lookupMax r

map_findMin :: Map_ k v -> (k, v)
map_findMin m = case map_lookupMin m of
  Nothing -> error "Map.findMin: empty map has no minimal element"
  Just kv -> kv

map_findMax :: Map_ k v -> (k, v)
map_findMax m = case map_lookupMax m of
  Nothing -> error "Map.findMax: empty map has no maximal element"
  Just kv -> kv

map_deleteMin :: Map_ k v -> Map_ k v
map_deleteMin MTip_ = MTip_
map_deleteMin (MBin_ _ k v MTip_ r) = r
map_deleteMin (MBin_ _ k v l r) = map_balance k v (map_deleteMin l) r

map_deleteMax :: Map_ k v -> Map_ k v
map_deleteMax MTip_ = MTip_
map_deleteMax (MBin_ _ k v l MTip_) = l
map_deleteMax (MBin_ _ k v l r) = map_balance k v l (map_deleteMax r)

map_keysSet :: Map_ k v -> Set_ k
map_keysSet m = MSet_ (map_map (const ()) m)

-- Een gesorteerde lijst zonder dubbele sleutels als gebalanceerde boom.
map_fromDistinctAscList :: [(k, v)] -> Map_ k v
map_fromDistinctAscList xs = fst (map_build (length xs) xs)

map_fromAscList :: Eq k => [(k, v)] -> Map_ k v
map_fromAscList xs = map_fromDistinctAscList (map last (groupBy (\a b -> fst a == fst b) xs))

map_build :: Int -> [(k, v)] -> (Map_ k v, [(k, v)])
map_build n xs
  | n == 0 = (MTip_, xs)
  | otherwise = case map_build (n `div` 2) xs of
      (l, (k, v) : rest) -> case map_build (n - n `div` 2 - 1) rest of
        (r, rest2) -> (MBin_ n k v l r, rest2)

map_glue :: Map_ k v -> Map_ k v -> Map_ k v
map_glue MTip_ r = r
map_glue l MTip_ = l
map_glue l r
  | map_size l > map_size r = case map_findMax l of (k, v) -> map_balance k v (map_deleteMax l) r
  | otherwise = case map_findMin r of (k, v) -> map_balance k v l (map_deleteMin r)

map_bin :: k -> v -> Map_ k v -> Map_ k v -> Map_ k v
map_bin k v l r = MBin_ (map_size l + map_size r + 1) k v l r

map_balance :: k -> v -> Map_ k v -> Map_ k v -> Map_ k v
map_balance k v l r
  | sl + sr <= 1 = MBin_ (sl + sr + 1) k v l r
  | sr > 3 * sl = map_rotateL k v l r
  | sl > 3 * sr = map_rotateR k v l r
  | otherwise = MBin_ (sl + sr + 1) k v l r
  where sl = map_size l
        sr = map_size r

map_rotateL :: k -> v -> Map_ k v -> Map_ k v -> Map_ k v
map_rotateL k v l (MBin_ _ k2 v2 ly ry)
  | map_size ly < 2 * map_size ry = map_bin k2 v2 (map_bin k v l ly) ry
  | otherwise = case ly of
      MBin_ _ k3 v3 t2 t3 -> map_bin k3 v3 (map_bin k v l t2) (map_bin k2 v2 t3 ry)

map_rotateR :: k -> v -> Map_ k v -> Map_ k v -> Map_ k v
map_rotateR k v (MBin_ _ k2 v2 ly ry) r
  | map_size ry < 2 * map_size ly = map_bin k2 v2 ly (map_bin k v ry r)
  | otherwise = case ry of
      MBin_ _ k3 v3 t2 t3 -> map_bin k3 v3 (map_bin k2 v2 ly t2) (map_bin k v t3 r)

-- Data.Set
set_unS :: Set_ a -> Map_ a ()
set_unS (MSet_ m) = m

set_empty :: Set_ a
set_empty = MSet_ MTip_

set_singleton :: a -> Set_ a
set_singleton x = MSet_ (map_singleton x ())

set_fromList :: Ord a => [a] -> Set_ a
set_fromList xs = MSet_ (foldl' (\m x -> map_insert x () m) MTip_ xs)

set_toList :: Set_ a -> [a]
set_toList s = map_keys (set_unS s)

set_toAscList :: Set_ a -> [a]
set_toAscList s = set_toList s

set_elems :: Set_ a -> [a]
set_elems s = set_toList s

set_toDescList :: Set_ a -> [a]
set_toDescList s = reverse (set_toList s)

set_insert :: Ord a => a -> Set_ a -> Set_ a
set_insert x s = MSet_ (map_insert x () (set_unS s))

set_delete :: Ord a => a -> Set_ a -> Set_ a
set_delete x s = MSet_ (map_delete x (set_unS s))

set_member :: Ord a => a -> Set_ a -> Bool
set_member x s = map_member x (set_unS s)

set_notMember :: Ord a => a -> Set_ a -> Bool
set_notMember x s = not (set_member x s)

set_size :: Set_ a -> Int
set_size s = map_size (set_unS s)

set_null :: Set_ a -> Bool
set_null s = map_null (set_unS s)

set_union :: Ord a => Set_ a -> Set_ a -> Set_ a
set_union a b = MSet_ (map_union (set_unS a) (set_unS b))

set_unions :: Ord a => [Set_ a] -> Set_ a
set_unions ss = foldl set_union set_empty ss

set_intersection :: Ord a => Set_ a -> Set_ a -> Set_ a
set_intersection a b = MSet_ (map_intersection (set_unS a) (set_unS b))

set_difference :: Ord a => Set_ a -> Set_ a -> Set_ a
set_difference a b = MSet_ (map_difference (set_unS a) (set_unS b))

set_backslash :: Ord a => Set_ a -> Set_ a -> Set_ a
set_backslash a b = set_difference a b

set_filter :: (a -> Bool) -> Set_ a -> Set_ a
set_filter p s = MSet_ (map_filterWithKey (\k v -> p k) (set_unS s))

set_partition :: (a -> Bool) -> Set_ a -> (Set_ a, Set_ a)
set_partition p s = (set_filter p s, set_filter (\x -> not (p x)) s)

set_map :: Ord b => (a -> b) -> Set_ a -> Set_ b
set_map f s = set_fromList (map f (set_toList s))

set_foldr :: (a -> b -> b) -> b -> Set_ a -> b
set_foldr f z s = map_foldrWithKey (\k v acc -> f k acc) z (set_unS s)

set_foldl :: (b -> a -> b) -> b -> Set_ a -> b
set_foldl f z s = map_foldlWithKey (\acc k v -> f acc k) z (set_unS s)

set_findMin :: Set_ a -> a
set_findMin s = fst (map_findMin (set_unS s))

set_findMax :: Set_ a -> a
set_findMax s = fst (map_findMax (set_unS s))

set_lookupMin :: Set_ a -> Maybe a
set_lookupMin s = case map_lookupMin (set_unS s) of
  Nothing -> Nothing
  Just (k, v) -> Just k

set_lookupMax :: Set_ a -> Maybe a
set_lookupMax s = case map_lookupMax (set_unS s) of
  Nothing -> Nothing
  Just (k, v) -> Just k

set_deleteMin :: Set_ a -> Set_ a
set_deleteMin s = MSet_ (map_deleteMin (set_unS s))

set_deleteMax :: Set_ a -> Set_ a
set_deleteMax s = MSet_ (map_deleteMax (set_unS s))

set_isSubsetOf :: Ord a => Set_ a -> Set_ a -> Bool
set_isSubsetOf a b = all (\x -> set_member x b) (set_toList a)
